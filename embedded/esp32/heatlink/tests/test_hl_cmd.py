"""The heatlink's own command parser (port/hl_cmd.c), through hl-cmd.

Contract: docs/superpowers/specs/2026-10-19-heatlink-v2-prototype-design.md, "Heatlink commands".
"""

import json

import pytest

from conftest import every_day, schedule


@pytest.fixture
def cmd(json_tool):
    run = json_tool("hl-cmd")

    def go(c):
        (out,) = run(c)
        return out

    return go


def err(cmd, c):
    out = cmd(c)
    assert out["kind"] == "error", out
    return out["message"]


# ---- simple commands -------------------------------------------------------------------------

def test_get_status(cmd):
    assert cmd({"command": "get_status"}) == {"kind": "get_status"}


def test_reboot(cmd):
    assert cmd({"command": "reboot"}) == {"kind": "reboot"}


@pytest.mark.parametrize("c", ["get_version", "ping", "ota_cancel", "ota_update", "url_chunk"])
def test_fleet_commands_pass_through(cmd, c):
    assert cmd({"command": c}) == {"kind": "fleet"}


@pytest.mark.parametrize("c", ["wipe", "set_setting", "DEMAND", "set_cap", ""])
def test_unknown_commands(cmd, c):
    assert err(cmd, {"command": c}) == "unknown command"


@pytest.mark.parametrize("text", ["", "not json", '{"command":42}', "{}", "[]", '"demand"', "null"])
def test_garbage_is_an_error(cmd, text):
    assert cmd(text)["kind"] == "error"


@pytest.mark.parametrize("tail", ["x", "{}", "}", "0"])
def test_trailing_bytes_are_refused(cmd, tail):
    assert err(cmd, '{"command":"get_status"}' + tail) == "trailing bytes after the JSON"


def test_trailing_whitespace_is_fine(cmd):
    assert cmd('{"command":"get_status"}  \t') == {"kind": "get_status"}


def test_deep_nesting_is_refused(cmd):
    assert err(cmd, '{"command":"get_status","x":' + "[" * 8 + "]" * 8 + "}") == "too deeply nested"
    assert err(cmd, "[" * 2000) == "too deeply nested"


def test_brackets_in_strings_do_not_count(cmd):
    assert cmd('{"command":"get_status","s":"[[[[[[[[[[\\"{{{{{{{{"}') == {"kind": "get_status"}


# ---- demand ---------------------------------------------------------------------------------

def test_demand_as_the_daemon_sends_it(cmd):
    out = cmd({"command": "demand", "on": True, "source": "schedule", "setpoint": 20.5,
               "temperature": 19.8, "ttl_s": 300})
    assert out == {"kind": "demand", "on": True, "source": "schedule", "ttl_s": 300, "setpoint": 2050,
                   "temperature": 1980}


@pytest.mark.parametrize("source", ["schedule", "override", "frost", "off"])
def test_demand_sources(cmd, source):
    assert cmd({"command": "demand", "on": False, "source": source})["source"] == source


def test_demand_defaults(cmd):
    assert cmd({"command": "demand", "on": False}) == {
        "kind": "demand", "on": False, "source": "override", "ttl_s": 300, "setpoint": None, "temperature": None}


@pytest.mark.parametrize("ttl,clamped", [(0, 60), (-5, 60), (59.9, 60), (60, 60), (61.7, 61), (1800, 1800),
                                         (1801, 1800), (1e9, 1800)])
def test_demand_ttl_is_clamped(cmd, ttl, clamped):
    assert cmd({"command": "demand", "on": True, "ttl_s": ttl})["ttl_s"] == clamped


@pytest.mark.parametrize("on", [None, 1, "true", 0])
def test_demand_needs_a_boolean_on(cmd, on):
    c = {"command": "demand", "source": "schedule"}
    if on is not None:
        c["on"] = on
    assert err(cmd, c) == "demand needs a boolean on"


@pytest.mark.parametrize("source", ["fallback", "switch", "SCHEDULE", 3, None])
def test_demand_refuses_other_sources(cmd, source):
    assert err(cmd, {"command": "demand", "on": True, "source": source}).startswith("source must be")


@pytest.mark.parametrize("ttl", ['"300"', "null", "true", "1e400"])
def test_demand_refuses_a_bad_ttl(cmd, ttl):
    assert err(cmd, '{"command":"demand","on":true,"ttl_s":' + ttl + "}") == "ttl_s must be a number"


@pytest.mark.parametrize("field", ["setpoint", "temperature"])
@pytest.mark.parametrize("value", ['"20"', "true", "101", "-101", "1e400"])
def test_demand_refuses_bad_readings(cmd, field, value):
    msg = err(cmd, '{"command":"demand","on":true,"' + field + '":' + value + "}")
    assert msg.startswith(field)


def test_demand_readings_may_be_null(cmd):
    out = cmd({"command": "demand", "on": True, "setpoint": None, "temperature": -2.345})
    assert out["setpoint"] is None and out["temperature"] == -235


# ---- set_schedule ---------------------------------------------------------------------------

WEEK = [[[360, 20.0], [540, 16.0], [1020, 20.5], [1320, 15.0]]] * 5 + [[[480, 21.0], [1380, 15.0]]] * 2


def test_set_schedule_as_the_daemon_sends_it(cmd):
    out = cmd(schedule(WEEK, tz="GMT0BST,M3.5.0/1,M10.5.0", comfort_c=18.0, duty_pct=67))
    assert out["kind"] == "set_schedule" and out["valid"]
    assert out["tz"] == "GMT0BST,M3.5.0/1,M10.5.0"
    assert out["comfort"] == 1800 and out["duty"] == 67
    assert out["days"][0] == [[360, 2000], [540, 1600], [1020, 2050], [1320, 1500]]
    assert out["days"][6] == [[480, 2100], [1380, 1500]]


def test_set_schedule_defaults(cmd):
    out = cmd(schedule())
    assert out == {"kind": "set_schedule", "tz": "GMT0BST,M3.5.0/1,M10.5.0", "comfort": 1800, "duty": 67,
                   "valid": True, "days": [[]] * 7}


def test_entries_are_sorted(cmd):
    out = cmd(schedule([[[540, 16.0], [0, 15.0], [360, 20.0]]] + [[]] * 6))
    assert out["days"][0] == [[0, 1500], [360, 2000], [540, 1600]] and out["valid"]


def test_same_minute_keeps_the_later_entry(cmd):
    out = cmd(schedule([[[360, 20.0], [360, 21.0]]] + [[]] * 6))
    assert out["days"][0] == [[360, 2100]]


def test_eight_entries_a_day_is_the_limit(cmd):
    eight = [[m * 60, 18.0] for m in range(8)]
    assert len(cmd(schedule(every_day(eight)))["days"][3]) == 8
    assert err(cmd, schedule([eight + [[1400, 18.0]]] + [[]] * 6)) == "at most 8 entries a day"


@pytest.mark.parametrize("target,centi", [(-5, 0), (0, 0), (30, 3000), (35.5, 3000), (1e300, 3000),
                                          (-1e300, 0), (19.994, 1999), (19.995, 2000)])
def test_targets_are_clamped(cmd, target, centi):
    assert cmd(schedule(every_day([[0, target]])))["days"][0] == [[0, centi]]


@pytest.mark.parametrize("comfort,centi", [(0, 500), (4.99, 500), (5, 500), (21.25, 2125), (30, 3000), (99, 3000)])
def test_comfort_is_clamped(cmd, comfort, centi):
    assert cmd(schedule(comfort_c=comfort))["comfort"] == centi


@pytest.mark.parametrize("duty,clamped", [(-10, 0), (0, 0), (66.5, 67), (66.4, 66), (100, 100), (150, 100)])
def test_duty_is_clamped_and_rounded(cmd, duty, clamped):
    assert cmd(schedule(duty_pct=duty))["duty"] == clamped


@pytest.mark.parametrize("days", [None, [], [[]] * 6, [[]] * 8, "x", {"Mon": []}])
def test_days_must_be_seven(cmd, days):
    c = {"command": "set_schedule"}
    if days is not None:
        c["days"] = days
    assert err(cmd, c) == "days must be an array of 7 days, Monday first"


def test_each_day_must_be_an_array(cmd):
    assert err(cmd, schedule([{}] + [[]] * 6)).startswith("each day must be")


@pytest.mark.parametrize("entry", [[360], [360, 20.0, 1], ["06:00", 20.0], [360, "20"], [360, None], {"at": 360},
                                   360])
def test_entries_must_be_pairs_of_numbers(cmd, entry):
    assert err(cmd, schedule([[entry]] + [[]] * 6)) == "each entry must be [minute, target_c]"


@pytest.mark.parametrize("minute", [-1, 1440, 100000, 360.5])
def test_minutes_must_be_whole_and_in_the_day(cmd, minute):
    assert err(cmd, schedule([[[minute, 20.0]]] + [[]] * 6)) == "minute must be a whole number from 0 to 1439"


@pytest.mark.parametrize("minute", [0, 1439])
def test_minute_edges(cmd, minute):
    assert cmd(schedule([[[minute, 20.0]]] + [[]] * 6))["days"][0] == [[minute, 2000]]


@pytest.mark.parametrize("field,value", [("comfort_c", "18"), ("duty_pct", "67"), ("comfort_c", None),
                                         ("duty_pct", True)])
def test_bad_tunables(cmd, field, value):
    assert err(cmd, schedule(**{field: value})) == f"{field} must be a number"


@pytest.mark.parametrize("tz", ["", "Europe/London ", "GMT0 BST", "A" * 64, 5, "GMT0\nBST", "x;rm"])
def test_bad_tz(cmd, tz):
    assert err(cmd, schedule(tz=tz)).startswith("tz must be")


@pytest.mark.parametrize("tz", ["UTC0", "CET-1CEST,M3.5.0,M10.5.0/3", "<+0330>-3:30", "A" * 63])
def test_good_tz(cmd, tz):
    assert cmd(schedule(tz=tz))["tz"] == tz


def test_a_full_week_fits_the_command_buffer():
    # app.c refuses commands over 2 KB; the largest schedule the daemon can send must fit.
    full = schedule(every_day([[1439 - i, 22.25] for i in range(8)]), tz="GMT0BST,M3.5.0/1,M10.5.0",
                    comfort_c=18.0, duty_pct=67)
    assert len(json.dumps(full)) < 2048
