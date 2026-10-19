"""The switch (port/switch_in.c), the status LED (port/led.c) and local time (port/hl_time.c)."""

import datetime as dt

import pytest

LONDON = "GMT0BST,M3.5.0/1,M10.5.0"


# ---- switch ---------------------------------------------------------------------------------

@pytest.mark.parametrize("on_low,off_low,pos", [(0, 0, "auto"), (1, 0, "on"), (0, 1, "off"), (1, 1, "off")])
def test_switch_from_pins(tool, on_low, off_low, pos):
    assert tool("hl-switch", "--pins", str(on_low), str(off_low))("").strip() == pos


@pytest.fixture
def debounce(tool):
    run = tool("hl-switch")

    def go(*readings):
        return run("".join(f"{t} {p}\n" for t, p in readings)).splitlines()

    return go


def test_first_reading_is_taken_at_once(debounce):
    assert debounce((0, "on")) == ["on 0"]


def test_a_change_counts_after_50_ms(debounce):
    # A new position read first at t=100 counts from t=150.
    out = debounce((0, "auto"), (100, "on"), (120, "on"), (140, "on"), (149, "on"), (150, "on"), (170, "on"))
    assert out == ["auto 0", "auto 0", "auto 0", "auto 0", "auto 0", "on 1", "on 0"]


def test_bounces_shorter_than_50_ms_are_ignored(debounce):
    seq = [(0, "auto")] + [(20 * i, "on" if i % 2 else "auto") for i in range(1, 20)]
    assert all(line == "auto 0" for line in debounce(*seq))


def test_bounce_restarts_the_timer(debounce):
    out = debounce((0, "auto"), (20, "off"), (40, "off"), (60, "auto"), (80, "off"), (100, "off"), (120, "off"),
                   (140, "off"))
    # off from 80: stable at 130+, so 140 is the first.
    assert [line.split()[0] for line in out] == ["auto"] * 7 + ["off"]
    assert out[-1] == "off 1"


def test_through_the_centre_to_the_other_throw(debounce):
    out = debounce((0, "on"), (20, "auto"), (40, "off"), (60, "off"), (80, "off"), (100, "off"))
    # auto for only 20 ms is skipped; off from 40 lands at 90+.
    assert out == ["on 0", "on 0", "on 0", "on 0", "on 0", "off 1"]


def test_change_back_before_it_settles_is_no_change(debounce):
    out = debounce((0, "auto"), (20, "on"), (40, "auto"), (100, "auto"))
    assert out == ["auto 0"] * 4


# ---- LED ------------------------------------------------------------------------------------

@pytest.mark.parametrize("mode,relay,colour", [
    ("auto", False, "green"),
    ("auto", True, "orange"),
    ("fallback", False, "blue"),
    ("fallback", True, "orange"),
    ("force_on", True, "purple"),
    ("force_off", False, "purple"),
])
def test_led_colours_when_connected(tool, mode, relay, colour):
    for now in ("0", "500", "123456"):
        assert tool("hl-led", mode, str(int(relay)), "1", now)("").strip() == colour


@pytest.mark.parametrize("mode,relay,colour", [("auto", False, "green"), ("fallback", False, "blue"),
                                               ("force_on", True, "purple")])
def test_led_blinks_red_while_disconnected(tool, mode, relay, colour):
    seen = [tool("hl-led", mode, str(int(relay)), "0", str(t))("").strip() for t in (0, 499, 500, 999, 1000)]
    assert seen == ["red", "red", colour, colour, "red"]


@pytest.mark.parametrize("colour,level,rgb", [("green", 255, "0 255 0"), ("red", 255, "255 0 0"),
                                              ("blue", 0, "0 0 0"), ("orange", 51, "51 16 0"),
                                              ("purple", 255, "160 0 255")])
def test_led_rgb(tool, colour, level, rgb):
    assert tool("hl-led", "--rgb", colour, str(level))("").strip() == rgb


# ---- local time -----------------------------------------------------------------------------

def epoch(iso):
    return str(int(dt.datetime.fromisoformat(iso).timestamp()))


def local(tool, tz, *isos):
    out = tool("hl-time", tz, *[epoch(i) for i in isos])("").splitlines()
    return [tuple(int(x) for x in line.split()) for line in out]


def test_winter_is_gmt(tool):
    # Monday 5 Jan 2026 07:30Z = 07:30 local, Monday.
    assert local(tool, LONDON, "2026-01-05T07:30:00+00:00") == [(0, 450)]


def test_summer_is_bst(tool):
    # Wednesday 1 Jul 2026 12:00Z = 13:00 BST.
    assert local(tool, LONDON, "2026-07-01T12:00:00+00:00") == [(2, 780)]


def test_spring_forward(tool):
    # Sunday 29 Mar 2026: 00:59:59Z is 00:59 GMT; 01:00Z is 02:00 BST.
    assert local(tool, LONDON, "2026-03-29T00:59:59+00:00", "2026-03-29T01:00:00+00:00") == [(6, 59), (6, 120)]


def test_fall_back(tool):
    # Sunday 25 Oct 2026: 00:59:59Z is 01:59 BST; 01:00Z is 01:00 GMT.
    assert local(tool, LONDON, "2026-10-25T00:59:59+00:00", "2026-10-25T01:00:00+00:00") == [(6, 119), (6, 60)]


def test_local_day_differs_from_utc_day(tool):
    # Sunday 23:30Z in summer is Monday 00:30 BST: Monday's schedule applies.
    assert local(tool, LONDON, "2026-06-28T23:30:00+00:00") == [(0, 30)]


def test_other_zone(tool):
    assert local(tool, "CET-1CEST,M3.5.0,M10.5.0/3", "2026-01-05T07:30:00+00:00") == [(0, 510)]


def test_invalid_tz_falls_back_to_london(tool):
    assert local(tool, "bad zone!", "2026-07-01T12:00:00+00:00") == [(2, 780)]


@pytest.mark.parametrize("tz,ok", [(LONDON, 1), ("UTC0", 1), ("", 0), ("a b", 0), ("A" * 63, 1), ("A" * 64, 0),
                                   ("x;y", 0), ("é", 0)])
def test_tz_valid(tool, tz, ok):
    assert tool("hl-time", "--tz-valid", tz)("").strip() == str(ok)


@pytest.mark.parametrize("t,ok", [(0, 0), (1735689599, 0), (1735689600, 1), (1792890000, 1)])
def test_time_valid(tool, t, ok):
    assert tool("hl-time", "--valid", str(t))("").strip() == str(ok)
