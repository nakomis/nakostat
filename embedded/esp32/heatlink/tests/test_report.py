"""When the heatlink publishes /status, and why (port/report.c), through hl-report.

Spec: "Heatlink status": every 60 s (heartbeat), at once when mode or relay changes (change), and
after every connect (boot the first time). Review fixes (STAT-70): a change made while MQTT is down,
or whose publish failed or was never acknowledged, is reported as "change" once it is back; a
failed publish is retried after 5 s, not on every 20 ms loop.
"""

import json
import subprocess

import pytest

from conftest import BUILD


class Reporter:
    """One hl-report process: its state carries over from step to step."""

    def __init__(self):
        self.proc = subprocess.Popen([str(BUILD / "hl-report")], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, text=True)
        self.now = 0

    def _send(self, msg):
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()
        return json.loads(self.proc.stdout.readline())["publish"]

    def step(self, at=None, mqtt=True, changed=False, acked=False, ok=True):
        """One loop of the app task. Returns the reason published (or attempted), or None."""
        if at is not None:
            self.now = at
        return self._send({"now": self.now, "mqtt": mqtt, "changed": changed, "acked": acked, "ok": ok})

    def request(self, at=None, ok=True):
        if at is not None:
            self.now = at
        return self._send({"request": True, "now": self.now, "ok": ok})

    def close(self):
        self.proc.stdin.close()
        self.proc.wait(timeout=5)


@pytest.fixture
def r():
    rep = Reporter()
    yield rep
    rep.close()


def booted(r, at=1000):
    """Connected and the boot status out and acknowledged."""
    assert r.step(at) == "boot"
    assert r.step(at + 20, acked=True) is None


# ---- boot and heartbeat ----------------------------------------------------------------------

def test_boot_status_on_the_first_connect(r):
    assert r.step(0, mqtt=False) is None
    assert r.step(500, mqtt=False) is None
    assert r.step(1000) == "boot"
    assert r.step(1020) is None


def test_heartbeat_every_60_s_after_the_last_status(r):
    booted(r, 1000)
    assert r.step(60_999) is None
    assert r.step(61_000) == "heartbeat"
    assert r.step(61_020) is None
    assert r.step(121_000) == "heartbeat"


def test_a_change_before_the_first_connect_is_covered_by_the_boot_status(r):
    assert r.step(0, mqtt=False, changed=True) is None
    assert r.step(1000) == "boot"
    assert r.step(1020, acked=True) is None


def test_reconnect_without_a_change_publishes_a_heartbeat(r):
    booted(r)
    assert r.step(5000, mqtt=False) is None
    assert r.step(6000) == "heartbeat"
    assert r.step(6020) is None


def test_a_request_resets_the_heartbeat(r):
    booted(r, 1000)
    assert r.request(30_000) == "request"
    assert r.step(61_000) is None
    assert r.step(90_000) == "heartbeat"


# ---- changes -----------------------------------------------------------------------------------

def test_a_change_while_connected_is_published_at_once(r):
    booted(r)
    assert r.step(5000, changed=True) == "change"
    assert r.step(5020, acked=True) is None


def test_a_change_while_down_is_reported_as_change_after_reconnect(r):
    booted(r)
    assert r.step(5000, mqtt=False) is None
    assert r.step(6000, mqtt=False, changed=True) is None
    assert r.step(7000, mqtt=False, changed=True) is None  # several changes: one report
    assert r.step(8000) == "change"
    assert r.step(8020, acked=True) is None


def test_a_failed_change_publish_is_retried_as_change_after_5_s(r):
    booted(r)
    assert r.step(5000, changed=True, ok=False) == "change"
    assert r.step(5020) is None
    assert r.step(9999) is None
    assert r.step(10_000) == "change"
    assert r.step(10_020, acked=True) is None


def test_an_unacknowledged_change_is_reported_again_after_reconnect(r):
    # Queued while the link was already dead (MQTT notices only at keepalive), then dropped.
    booted(r)
    assert r.step(5000, changed=True) == "change"
    assert r.step(5020) is None  # never acknowledged
    assert r.step(30_000, mqtt=False) is None
    assert r.step(40_000) == "change"


def test_an_acknowledged_change_is_not_reported_again(r):
    booted(r)
    assert r.step(5000, changed=True) == "change"
    assert r.step(5100, acked=True) is None
    assert r.step(30_000, mqtt=False) is None
    assert r.step(40_000) == "heartbeat"


def test_a_later_acknowledged_status_covers_an_earlier_change(r):
    # QoS 1 acknowledgements come in order: a later status acknowledged means the change got there.
    booted(r)
    assert r.step(5000, changed=True) == "change"
    assert r.step(65_000) == "heartbeat"
    assert r.step(65_100, acked=True) is None
    assert r.step(70_000, mqtt=False) is None
    assert r.step(80_000) == "heartbeat"


def test_an_unacknowledged_boot_is_reported_again_after_reconnect(r):
    assert r.step(1000) == "boot"
    assert r.step(2000, mqtt=False) is None
    assert r.step(3000) == "boot"


def test_a_change_with_a_failed_boot_waits_for_the_boot(r):
    assert r.step(1000, ok=False) == "boot"
    assert r.step(2000, changed=True) is None   # within the retry interval
    assert r.step(6000) == "boot"               # the boot status carries the new state
    assert r.step(6020, acked=True) is None


# ---- failures back off -------------------------------------------------------------------------

def test_a_failed_heartbeat_is_retried_after_5_s_not_every_loop(r):
    booted(r, 1000)
    assert r.step(61_000, ok=False) == "heartbeat"
    for t in range(61_020, 66_000, 20):
        assert r.step(t) is None, t
    assert r.step(66_000) == "heartbeat"
    assert r.step(66_020) is None


def test_a_failed_boot_is_retried_after_5_s(r):
    assert r.step(1000, ok=False) == "boot"
    assert r.step(1020) is None
    assert r.step(6000) == "boot"


def test_a_reconnect_reports_at_once_despite_an_earlier_failure(r):
    booted(r, 1000)
    assert r.step(61_000, ok=False) == "heartbeat"
    assert r.step(61_100, mqtt=False) is None
    assert r.step(61_200) == "heartbeat"


def test_a_failed_reconnect_status_is_still_owed(r):
    booted(r, 1000)
    assert r.step(5000, mqtt=False) is None
    assert r.step(6000, ok=False) == "heartbeat"
    assert r.step(6020) is None
    assert r.step(11_000) == "heartbeat"


def test_nothing_is_published_while_down(r):
    booted(r)
    for t in range(2000, 200_000, 10_000):
        assert r.step(t, mqtt=False, changed=True) is None
