"""The heatlink's decision table (port/heatlink.c), through hl-decide.

Spec: docs/superpowers/specs/2026-10-19-heatlink-v2-prototype-design.md, "Heatlink logic".
"""

import pytest

from conftest import every_day, schedule

# Mon 06:00 20 degC, 22:00 14 degC; comfort 18: heats from 06:00 to 22:00, 40 minutes an hour.
SCHED = schedule(every_day([[360, 20.0], [1320, 14.0]]), comfort_c=18.0, duty_pct=67)
MON_0700 = [0, 420]
MON_0745 = [0, 465]
MON_2300 = [0, 1380]


@pytest.fixture
def decide(json_tool):
    run = json_tool("hl-decide")

    def go(**scenario):
        (out,) = run(scenario)
        assert "error" not in out, out
        return (out["mode"], out["relay"], out["source"])

    return go


def demand(on=True, source="schedule", age_ms=1000, ttl_s=300):
    return {"on": on, "source": source, "age_ms": age_ms, "ttl_s": ttl_s}


# ---- the switch wins over everything ---------------------------------------------------------

@pytest.mark.parametrize("d", [None, demand(on=False), demand(on=True), demand(age_ms=10**7)])
@pytest.mark.parametrize("sched", [None, SCHED])
def test_switch_on_forces_the_relay_on(decide, d, sched):
    assert decide(switch="on", demand=d, schedule=sched, time_valid=True, local=MON_0700) == (
        "force_on", True, "switch")


@pytest.mark.parametrize("d", [None, demand(on=False), demand(on=True), demand(age_ms=10**7)])
@pytest.mark.parametrize("sched", [None, SCHED])
def test_switch_off_forces_the_relay_off(decide, d, sched):
    assert decide(switch="off", demand=d, schedule=sched, time_valid=True, local=MON_0700) == (
        "force_off", False, "switch")


def test_switch_on_during_cold_boot(decide):
    assert decide(switch="on", now_ms=0) == ("force_on", True, "switch")


# ---- auto: a fresh demand is followed --------------------------------------------------------

@pytest.mark.parametrize("on", [True, False])
@pytest.mark.parametrize("source", ["schedule", "override", "frost", "off"])
def test_fresh_demand_is_followed_and_its_source_echoed(decide, on, source):
    assert decide(demand=demand(on=on, source=source)) == ("auto", on, source)


def test_fresh_demand_beats_the_fallback_schedule(decide):
    # The schedule would heat at Mon 07:00; the daemon says no (room warm enough): the daemon wins.
    assert decide(demand=demand(on=False), schedule=SCHED, time_valid=True, local=MON_0700) == (
        "auto", False, "schedule")


@pytest.mark.parametrize("ttl,age,mode", [
    (300, 0, "auto"),
    (300, 299_999, "auto"),
    (300, 300_000, "fallback"),   # age == ttl is stale
    (300, 300_001, "fallback"),
    (60, 59_999, "auto"),
    (60, 60_000, "fallback"),
    (1800, 1_799_999, "auto"),
    (1800, 1_800_000, "fallback"),
])
def test_demand_goes_stale_at_its_ttl(decide, ttl, age, mode):
    assert decide(demand=demand(on=True, age_ms=age, ttl_s=ttl))[0] == mode


@pytest.mark.parametrize("ttl,clamped", [(1, 60), (59, 60), (5000, 1800)])
def test_ttl_is_clamped(decide, ttl, clamped):
    assert decide(demand=demand(age_ms=clamped * 1000 - 1, ttl_s=ttl))[0] == "auto"
    assert decide(demand=demand(age_ms=clamped * 1000, ttl_s=ttl))[0] == "fallback"


def test_a_demand_from_the_future_is_not_trusted(decide):
    # received_ms after now_ms: can't happen on a monotonic clock; treated as stale.
    assert decide(demand=demand(age_ms=-5000))[0] == "fallback"


# ---- cold boot -----------------------------------------------------------------------------

@pytest.mark.parametrize("now_ms", [0, 1, 150_000, 299_999])
def test_cold_boot_keeps_the_relay_off_for_one_ttl(decide, now_ms):
    # Even when the schedule would heat: the daemon gets a chance to speak first.
    assert decide(now_ms=now_ms, schedule=SCHED, time_valid=True, local=MON_0700) == ("auto", False, "off")


def test_cold_boot_falls_back_after_one_ttl(decide):
    assert decide(now_ms=300_000, schedule=SCHED, time_valid=True, local=MON_0700) == (
        "fallback", True, "fallback")


def test_first_demand_during_cold_boot_is_followed_at_once(decide):
    assert decide(now_ms=5_000, demand=demand(on=True, age_ms=0)) == ("auto", True, "schedule")


def test_a_stale_demand_falls_back_even_early_after_boot(decide):
    # A demand at t=1 s with ttl 60 is stale at t=100 s, before the cold-boot window ends.
    assert decide(now_ms=100_000, demand=demand(age_ms=99_000, ttl_s=60), schedule=SCHED,
                  time_valid=True, local=MON_0700) == ("fallback", True, "fallback")


# ---- fallback ----------------------------------------------------------------------------

def test_fallback_heats_inside_the_duty_cycle(decide):
    assert decide(schedule=SCHED, time_valid=True, local=MON_0700) == ("fallback", True, "fallback")


def test_fallback_rests_outside_the_duty_cycle(decide):
    assert decide(schedule=SCHED, time_valid=True, local=MON_0745) == ("fallback", False, "fallback")


def test_fallback_off_below_comfort(decide):
    assert decide(schedule=SCHED, time_valid=True, local=MON_2300) == ("fallback", False, "fallback")


def test_fallback_without_a_schedule_is_off(decide):
    assert decide(schedule=None, time_valid=True, local=MON_0700) == ("fallback", False, "fallback")


def test_fallback_without_valid_time_is_off(decide):
    assert decide(schedule=SCHED, time_valid=False, local=MON_0700) == ("fallback", False, "fallback")


def test_fallback_with_an_empty_schedule_is_off(decide):
    assert decide(schedule=schedule(), time_valid=True, local=MON_0700) == ("fallback", False, "fallback")


def test_stale_demand_on_does_not_keep_the_boiler_on(decide):
    # The daemon said "on" ten minutes ago and went quiet; at 23:00 the schedule says no.
    assert decide(demand=demand(on=True, age_ms=600_000), schedule=SCHED, time_valid=True,
                  local=MON_2300) == ("fallback", False, "fallback")
