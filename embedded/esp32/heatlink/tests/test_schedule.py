"""The local schedule and the fallback duty cycle (port/schedule.c), through hl-sched.

Semantics match the daemon (sensor-daemon schedule.rs): the target in force is the most recent
entry at-or-before now, searching backwards around the week.
"""

import pytest

from conftest import every_day, schedule

MON, TUE, WED, THU, FRI, SAT, SUN = range(7)


@pytest.fixture
def at(json_tool):
    run = json_tool("hl-sched")

    def go(sched, *moments):
        (out,) = run({"schedule": sched, "at": [list(m) for m in moments]})
        assert "error" not in out, out
        return out

    return go


def targets(at, sched, *moments):
    return at(sched, *moments)["target"]


def heats(at, sched, *moments):
    return at(sched, *moments)["heat"]


def test_empty_schedule_has_no_target(at):
    assert targets(at, schedule(), (MON, 0), (SUN, 1439)) == [None, None]


def test_entry_holds_until_the_next(at):
    s = schedule(every_day([[360, 20.0], [540, 16.0]]))
    assert targets(at, s, (MON, 359), (MON, 360), (MON, 539), (MON, 540), (MON, 1439)) == [
        1600, 2000, 2000, 1600, 1600]


def test_early_monday_inherits_sunday_night(at):
    days = [[[420, 20.0]], [], [], [], [], [], [[420, 21.0], [1380, 15.0]]]
    assert targets(at, schedule(days), (MON, 0), (MON, 419), (MON, 420)) == [1500, 1500, 2000]


def test_empty_days_inherit_the_previous_day(at):
    days = [[[600, 19.0], [1200, 17.0]], [], [], [[480, 21.0]], [], [], []]
    assert targets(at, schedule(days), (TUE, 0), (WED, 720), (THU, 479), (THU, 480), (SUN, 1439)) == [
        1700, 1700, 1700, 2100, 2100]


def test_single_entry_holds_all_week(at):
    days = [[], [], [[720, 18.5]], [], [], [], []]
    moments = [(d, m) for d in range(7) for m in (0, 719, 720, 1439)]
    assert set(targets(at, schedule(days), *moments)) == {1850}


def test_before_the_only_entry_today_wraps_to_it(at):
    # Only Wednesday has entries, and now is Wednesday before the first: the week's last entry
    # (Wednesday's own last one) is in force.
    days = [[], [], [[600, 20.0], [900, 16.0]], [], [], [], []]
    assert targets(at, schedule(days), (WED, 599)) == [1600]


def test_week_wraparound_from_sunday_to_monday(at):
    days = [[[0, 19.0]], [], [], [], [], [], [[1439, 22.0]]]
    assert targets(at, schedule(days), (SUN, 1438), (SUN, 1439), (MON, 0)) == [1900, 2200, 1900]


def test_entry_at_midnight_counts_from_midnight(at):
    s = schedule(every_day([[0, 18.0], [720, 20.0]]))
    assert targets(at, s, (TUE, 0), (TUE, 719)) == [1800, 1800]


# ---- duty cycle ----------------------------------------------------------------------------

@pytest.mark.parametrize("pct,minutes", [(0, 0), (1, 1), (50, 30), (67, 40), (75, 45), (99, 59), (100, 60),
                                         (200, 60)])
def test_duty_minutes(tool, pct, minutes):
    assert tool("hl-sched", "--duty", str(pct))("").strip() == str(minutes)


def test_default_duty_is_40_on_20_off(at):
    s = schedule(every_day([[0, 20.0]]))  # comfort 18, duty 67 by default
    on = heats(at, s, *[(MON, m) for m in range(0, 120)])
    assert on == ([True] * 40 + [False] * 20) * 2


def test_duty_follows_the_clock_hour(at):
    s = schedule(every_day([[390, 20.0]]))  # heating from 06:30 every day
    assert heats(at, s, (MON, 389), (MON, 390), (MON, 399), (MON, 400), (MON, 419), (MON, 420)) == [
        True, True, True, False, False, True]
    # (06:29 is still heating: Sunday's 06:30 entry carried round the week.)


@pytest.mark.parametrize("duty,expect", [(0, [False, False]), (100, [True, True])])
def test_duty_extremes(at, duty, expect):
    s = schedule(every_day([[0, 20.0]]), duty_pct=duty)
    assert heats(at, s, (MON, 0), (MON, 59)) == expect


def test_heats_only_at_or_above_comfort(at):
    s = schedule(every_day([[0, 17.99], [300, 18.0], [600, 25.0], [900, 5.0]]), comfort_c=18.0)
    assert heats(at, s, (MON, 0), (MON, 300), (MON, 600), (MON, 900)) == [False, True, True, False]


def test_comfort_is_tunable(at):
    s = schedule(every_day([[0, 16.0]]), comfort_c=15.5)
    assert heats(at, s, (MON, 0)) == [True]


def test_empty_schedule_never_heats(at):
    assert heats(at, schedule(), (MON, 0), (FRI, 720)) == [False, False]


# ---- stored-schedule validation (what comes back from NVS) -------------------------------

@pytest.fixture
def valid(tool):
    run = tool("hl-sched", "--valid")
    import json

    def go(**raw):
        base = {"count": [0] * 7, "entries": [[] for _ in range(7)]}
        base.update(raw)
        return run(json.dumps(base) + "\n").strip() == "1"

    return go


def test_valid_empty(valid):
    assert valid()


def test_valid_entries(valid):
    assert valid(count=[2, 0, 0, 0, 0, 0, 0], entries=[[[360, 2000], [540, 1600]]] + [[]] * 6)


@pytest.mark.parametrize("raw", [
    {"count": [9, 0, 0, 0, 0, 0, 0]},
    {"count": [2, 0, 0, 0, 0, 0, 0], "entries": [[[540, 2000], [360, 1600]]] + [[]] * 6},   # unsorted
    {"count": [2, 0, 0, 0, 0, 0, 0], "entries": [[[360, 2000], [360, 1600]]] + [[]] * 6},   # duplicate
    {"count": [1, 0, 0, 0, 0, 0, 0], "entries": [[[1440, 2000]]] + [[]] * 6},
    {"count": [1, 0, 0, 0, 0, 0, 0], "entries": [[[0, 3001]]] + [[]] * 6},
    {"count": [1, 0, 0, 0, 0, 0, 0], "entries": [[[0, -1]]] + [[]] * 6},
    {"duty": 101},
    {"comfort": 499},
    {"comfort": 3001},
    {"tz": ""},
    {"unterminated_tz": True},
])
def test_invalid_stored_schedules(valid, raw):
    assert not valid(**raw)
