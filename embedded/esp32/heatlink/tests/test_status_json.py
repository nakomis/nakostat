"""The /status JSON (port/status_json.c), through hl-status.

Contract: docs/superpowers/specs/2026-10-19-heatlink-v2-prototype-design.md, "Heatlink status".
"""

import json

import pytest

FULL = {"mode": "auto", "relay": True, "switch": "auto", "source": "schedule", "demand_age_s": 12,
        "schedule_known": True, "time_valid": True, "rssi": -61, "uptime_s": 3600, "reason": "heartbeat",
        "version": "0.1.0"}


@pytest.fixture
def status(tool):
    run = tool("hl-status")

    def go(view):
        return run(json.dumps(view) + "\n").strip()

    return go


def test_full_status(status):
    out = status(FULL)
    assert json.loads(out) == FULL
    # Field order as the spec lists it.
    assert list(json.loads(out)) == list(FULL)


@pytest.mark.parametrize("field,values", [
    ("mode", ["auto", "fallback", "force_on", "force_off"]),
    ("switch", ["auto", "on", "off"]),
    ("source", ["schedule", "override", "frost", "off", "fallback", "switch"]),
    ("reason", ["boot", "heartbeat", "change", "request"]),
])
def test_enumerations(status, field, values):
    for v in values:
        assert json.loads(status({**FULL, field: v}))[field] == v


def test_unknowns_are_null(status):
    out = json.loads(status({**FULL, "demand_age_s": None, "rssi": None, "version": None}))
    assert out["demand_age_s"] is None and out["rssi"] is None and out["version"] is None


def test_zero_view(status):
    assert json.loads(status({})) == {
        "mode": "auto", "relay": False, "switch": "auto", "source": "schedule", "demand_age_s": None,
        "schedule_known": False, "time_valid": False, "rssi": None, "uptime_s": 0, "reason": "boot",
        "version": None}


def test_large_numbers(status):
    out = json.loads(status({**FULL, "uptime_s": 4_000_000_000, "demand_age_s": 2_000_000_000, "rssi": -127}))
    assert out["uptime_s"] == 4_000_000_000
    assert out["rssi"] == -127


def test_version_is_escaped(status):
    out = status({**FULL, "version": 'a"b\\c\n'})
    assert json.loads(out)["version"] == 'a"b\\c\n'


def test_buffer_too_small(status):
    n = len(status(FULL))
    assert status({**FULL, "_bufsize": n}) == "ERR"  # no room for the NUL
    assert json.loads(status({**FULL, "_bufsize": n + 1})) == FULL


def test_fits_the_app_buffer(status):
    # app.c builds status into 384 bytes; the longest values must fit.
    worst = {**FULL, "mode": "force_off", "source": "override", "demand_age_s": 4294967295, "rssi": -127,
             "uptime_s": 4294967295, "reason": "heartbeat", "version": "9999.9999.9999"}
    assert len(status(worst)) < 384
