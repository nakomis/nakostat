"""bench/hlbench (STAT-82): the bench check's steps against a fake heatlink, the live-trial alerts, and
the watcher's plumbing. No MQTT: hlbench.link is the only part that needs the AWS SDK."""

import io
import json
import queue
import sys
import time

import pytest
from conftest import HEATLINK

sys.path.insert(0, str(HEATLINK / "bench"))
from hlbench import cli
from hlbench.steps import BENCH, Check, demand
from hlbench.trial import Trial

# ── the bench check ──────────────────────────────────────────────────────────

class FakeHeatlink:
    """A steps.Session whose heatlink follows the README's behaviour table, and whose operator moves
    the switch when told and answers yes (or `answers`)."""

    def __init__(self, board="devkitc", answers=None, version="0.1.4", broken=None, foreign=0):
        self.status = {"mode": "auto", "relay": False, "switch": "auto", "source": "off", "board": board,
                       "version": version, "rssi": -60, "time_valid": True, "schedule_known": False}
        if board is ...:
            del self.status["board"]
        self.answers = list(answers or [])
        self.broken = broken or set()   # "relay": the relay never closes
        self.sent, self.said, self.asked, self.foreign = [], [], [], foreign

    def _update(self):
        s = self.status
        if s["switch"] != "auto":
            s["mode"], s["relay"] = "force_on" if s["switch"] == "on" else "force_off", s["switch"] == "on"
        elif s.get("_demand") is not None:
            s["mode"], s["relay"], s["source"] = "auto", s["_demand"], "override"
        else:
            s["mode"], s["relay"] = "auto", False   # no demand since boot
        if "relay" in self.broken:
            s["relay"] = False

    def send(self, command):
        self.sent.append(command)
        if command["command"] == "demand":
            self.status["_demand"] = command["on"]
        self._update()

    def say(self, text):
        self.said.append(text)
        for word, pos in (("UP", "on"), ("DOWN", "off"), ("CENTRE", "auto")):
            if word in text:
                self.status["switch"] = pos
        self._update()

    def expect(self, want, timeout):
        if "Waiting for the demand to expire" in self.said[-1]:
            self.status.update(mode="fallback", relay=False, _demand=None)
        visible = {k: v for k, v in self.status.items() if not k.startswith("_")}
        return dict(visible) if want(visible) else None

    def ask(self, question):
        self.asked.append(question)
        return self.answers.pop(0) if self.answers else True

    def foreign_demands(self):
        return self.foreign


def test_a_working_heatlink_passes_every_step():
    h = FakeHeatlink()
    check = Check("devkitc")
    assert check.run(h)
    assert [r.step for r in check.results] == ["status", "switch on", "switch off", "switch auto",
                                               "demand on", "demand off", "fallback"]
    assert "PASS" in check.report().splitlines()[0]
    # It leaves the heatlink with demand off, and marks everything it sent as its own.
    assert h.sent[-1] == demand(False, ttl_s=60) and h.sent[-1]["by"] == BENCH


def test_quick_skips_the_fallback():
    check = Check("devkitc", fallback=False)
    assert check.run(FakeHeatlink())
    assert "fallback" not in [r.step for r in check.results]


def test_the_wrong_board_stops_the_check():
    check = Check("pcb-v1")
    assert not check.run(FakeHeatlink(board="devkitc"))
    assert len(check.results) == 1
    assert "reprovision with --board pcb-v1" in check.results[0].detail


def test_board_null_is_the_wrong_board():
    check = Check("pcb-v1")
    assert not check.run(FakeHeatlink(board=None))
    assert "board is None" in check.results[0].detail


def test_firmware_without_a_board_field_is_too_old():
    check = Check("devkitc")
    assert not check.run(FakeHeatlink(board=..., version="0.1.1"))
    assert "flash a current build" in check.results[0].detail


def test_a_relay_that_never_closes_fails_with_the_last_status():
    check = Check("devkitc", fallback=False)
    assert not check.run(FakeHeatlink(broken={"relay"}))
    failed = {r.step: r.detail for r in check.results if not r.ok}
    assert set(failed) == {"switch on", "demand on"}
    assert "expected switch on, force_on, relay on" in failed["switch on"]
    assert "relay=False" in failed["switch on"]


def test_what_the_operator_does_not_see_fails():
    check = Check("devkitc", fallback=False)
    assert not check.run(FakeHeatlink(answers=[True, False]))   # the relay didn't drop out
    assert [r.step for r in check.results if not r.ok] == ["switch off"]


def test_the_pcb_is_checked_at_j2():
    h = FakeHeatlink(board="pcb-v1")
    assert Check("pcb-v1", fallback=False).run(h)
    assert all("J2" in q for q in h.asked)
    assert "status LED purple" in h.asked[0] and "orange" in h.asked[2] and "green" in h.asked[3]


def test_someone_elses_demands_fail_the_check():
    check = Check("devkitc", fallback=False)
    assert not check.run(FakeHeatlink(foreign=2))
    assert "stop it and run the check again" in check.results[-1].detail


# ── the live-trial alerts ────────────────────────────────────────────────────

def status(**kw):
    return {"mode": "auto", "relay": False, "switch": "auto", "board": "devkitc", "version": "0.1.4",
            "rssi": -60, "uptime_s": 100, **kw}


def kinds(alerts):
    return [(a.kind, a.cleared) for a in alerts]


def test_silence_is_raised_once_and_cleared_by_the_next_status():
    t = Trial()
    t.feed("status", status(), 0)
    assert t.tick(140) == []
    assert kinds(t.tick(151)) == [("silent", False)]
    assert t.tick(400) == []
    assert ("silent", True) in kinds(t.feed("status", status(uptime_s=500), 410))


def test_a_heatlink_silent_from_the_start_is_silent():
    t = Trial(started=1000)
    assert t.tick(1140) == []
    alerts = t.tick(1151)
    assert kinds(alerts) == [("silent", False)] and "since the watcher started" in alerts[0].message


def test_the_watchers_own_link_is_not_blamed_on_the_heatlink():
    t = Trial(started=0)
    alerts = t.link("no AWS credentials (TokenRetrievalError): aws sso login --profile nakom.is")
    assert kinds(alerts) == [("link", False)] and "watcher's own connection" in alerts[0].message
    assert t.link("connection lost: x") == []     # once
    assert t.tick(1000) == []                      # no silent while we can't hear
    assert kinds(t.link("reconnected")) == [("link", True)]
    assert kinds(t.tick(1001)) == [("silent", False)]


def test_board_null_is_an_error_but_no_board_field_is_not():
    t = Trial()
    old = status()
    del old["board"]
    assert t.feed("status", old, 0) == []
    alerts = t.feed("status", status(board=None), 60)
    assert kinds(alerts) == [("board", False)] and alerts[0].level == "error"
    assert t.feed("status", status(board=None), 120) == []
    assert kinds(t.feed("status", status(board="pcb-v1"), 180)) == [("board", True)]


def test_fallback_is_raised_and_cleared():
    t = Trial()
    assert kinds(t.feed("status", status(mode="fallback"), 0)) == [("fallback", False)]
    assert kinds(t.feed("status", status(), 60)) == [("fallback", True)]


def test_a_relay_that_disagrees_with_the_demand():
    t = Trial()
    t.feed("commands", {"command": "demand", "on": True}, 0)
    assert t.feed("status", status(relay=False), 2) == []            # too soon to tell
    alerts = t.feed("status", status(relay=False), 10)
    assert kinds(alerts) == [("disagree", False)]
    assert "relay is off but the daemon's demand is on" in alerts[0].message
    assert kinds(t.feed("status", status(relay=True), 20)) == [("disagree", True)]


def test_a_forced_switch_or_a_stale_demand_is_no_disagreement():
    t = Trial()
    t.feed("commands", {"command": "demand", "on": True}, 0)
    assert t.feed("status", status(mode="force_off", switch="off"), 10) == []
    assert t.feed("status", status(relay=False), 200) == []
    assert t.feed("commands", {"command": "get_status"}, 210) == []


def test_reboots_and_version_changes():
    t = Trial()
    t.feed("status", status(uptime_s=5000), 0)
    alerts = t.feed("status", status(uptime_s=3, version="0.1.5"), 60)
    assert kinds(alerts) == [("reboot", False), ("version", False)]
    assert "0.1.4 → 0.1.5" in alerts[1].message


def test_weak_wifi_has_hysteresis():
    t = Trial()
    assert kinds(t.feed("status", status(rssi=-82), 0)) == [("rssi", False)]
    assert t.feed("status", status(rssi=-77), 60) == []               # better, not yet clear
    assert kinds(t.feed("status", status(rssi=-74), 120)) == [("rssi", True)]
    assert t.feed("status", status(rssi=None), 180) == []


def test_a_relay_on_for_hours():
    t = Trial(relay_on_long_s=3600, silent_s=1e9)   # ticks only: no heartbeats
    t.feed("status", status(relay=True), 0)
    assert t.tick(3000) == []
    alerts = t.tick(3700)
    assert kinds(alerts) == [("relay_long", False)] and "1.0 h" in alerts[0].message
    assert t.tick(5000) == []
    assert kinds(t.feed("status", status(relay=False), 6000)) == [("relay_long", True)]


# ── the watcher's plumbing ───────────────────────────────────────────────────

def test_status_and_command_lines():
    line = cli.fmt(0, "status", status(reason="heartbeat"))
    assert "status" in line and "reason=heartbeat mode=auto relay=False" in line
    line = cli.fmt(0, "commands", {"command": "demand", "on": True, "ttl_s": 300})
    assert line.endswith('command  demand {"on":true,"ttl_s":300}')
    assert cli.fmt(0, "responses", {"type": "pong"}).endswith('responses {"type":"pong"}')


class FakeLink:
    def __init__(self):
        self.messages, self.sent = queue.Queue(), []

    def send(self, command):
        self.sent.append(command)


def test_a_status_from_before_the_step_does_not_pass_it(tmp_path):
    link = FakeLink()
    out = io.StringIO()
    s = cli.LinkSession(link, cli.Recorder(str(tmp_path / "log.jsonl"), out=out))
    link.messages.put((0, "status", status(relay=True)))
    assert s.expect(lambda st: st["relay"], timeout=0.6) is None
    assert link.sent and all(c["by"] == BENCH for c in link.sent)
    # The stale one is still logged.
    assert json.loads((tmp_path / "log.jsonl").read_text().splitlines()[0])["body"]["relay"] is True


def test_foreign_demands_are_counted_and_our_own_commands_are_not_shown():
    link = FakeLink()
    out = io.StringIO()
    s = cli.LinkSession(link, cli.Recorder(None, out=out))
    link.messages.put((0, "commands", {"command": "get_status", "by": BENCH}))
    link.messages.put((0, "commands", {"command": "demand", "on": True}))
    link.messages.put((0, "commands", {"command": "demand", "on": True, "by": BENCH}))
    s.expect(lambda st: True, timeout=0)
    assert s.foreign_demands() == 1
    assert out.getvalue().count("command") == 1


def test_check_needs_a_board():
    with pytest.raises(SystemExit):
        cli.parse(["check"])
    assert cli.parse(["check", "--board", "pcb-v1", "--env", "prod"]).board == "pcb-v1"


def test_the_trial_loop_records_alerts(tmp_path):
    link = FakeLink()
    link.messages.put((time.time(), "status", status(mode="fallback")))
    log = tmp_path / "trial.jsonl"
    cli.run_trial(link, cli.Recorder(str(log), out=io.StringIO()), Trial(), until=time.time() + 0.2)
    rows = [json.loads(r) for r in log.read_text().splitlines()]
    assert [r["kind"] for r in rows] == ["status", "alert"] and rows[1]["body"]["kind"] == "fallback"
