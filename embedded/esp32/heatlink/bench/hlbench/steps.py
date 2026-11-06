"""The bench check (STAT-82): the README's bench test as steps a script can run and check.

Each step tells the operator what to do (or sends a command itself), waits for a /status that shows
the expected result, and for what only a person can see (a relay click, the LED's colour) asks them.
The steps only talk to a Session, so the tests drive them with a fake one.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Protocol

BENCH = "bench"   # in every command we send ("by"; the firmware ignores unknown fields), so the
                  # check can tell its own demands from the daemon's


class Session(Protocol):
    def send(self, command: dict) -> None: ...

    def expect(self, want: Callable[[dict], bool], timeout: float) -> dict | None:
        """The first /status (asking for one every few seconds) for which want() holds, or None."""

    def ask(self, question: str) -> bool:
        """A yes/no from the operator."""

    def say(self, text: str) -> None: ...

    def foreign_demands(self) -> int:
        """How many demands someone else (the daemon) has sent since the check began."""


@dataclass
class Result:
    step: str
    ok: bool
    detail: str = ""


@dataclass
class Check:
    board: str
    fallback: bool = True       # wait for the fallback (about a minute)
    timeout: float = 20
    results: list[Result] = field(default_factory=list)
    status: dict | None = None  # the last status seen

    def run(self, s: Session) -> bool:
        steps = [self.identity, self.switch_on, self.switch_off, self.switch_auto, self.demand_on,
                 self.demand_off]
        if self.fallback:
            steps.append(self.goes_to_fallback)
        for step in steps:
            r = step(s)
            self.results.append(r)
            s.say(f"{'PASS' if r.ok else 'FAIL'} {r.step}{': ' + r.detail if r.detail else ''}")
            if not r.ok and step == self.identity:
                break   # the wrong board or firmware: nothing after this means anything
        if s.foreign_demands():
            self.results.append(Result("no other demands", False,
                                       f"{s.foreign_demands()} demand(s) from someone else (the daemon?) "
                                       "arrived during the check: stop it and run the check again"))
        # Leave it off. Without demand it falls back to its schedule after the ttl.
        s.send(demand(False, ttl_s=60))
        return self.ok

    @property
    def ok(self) -> bool:
        return bool(self.results) and all(r.ok for r in self.results)

    def _wait(self, s, name, want, describe, timeout=None):
        st = s.expect(want, self.timeout if timeout is None else timeout)
        if st is None:
            last = summary(self.status) if self.status else "no status at all"
            return Result(name, False, f"expected {describe}; last status: {last}")
        self.status = st
        return None

    def _see(self, s, name, question):
        return Result(name, True) if s.ask(question) else Result(name, False, f"not seen: {question}")

    def identity(self, s):
        s.say("Asking for a status…")
        st = s.expect(lambda st: True, self.timeout)
        if st is None:
            return Result("status", False, "no status: is the heatlink online and provisioned for this "
                                            "environment and Thing?")
        self.status = st
        if "board" not in st:
            return Result("status", False, f"firmware {st.get('version')} has no board field (before "
                                           "0.1.2): flash a current build")
        if st["board"] != self.board:
            return Result("status", False, f"board is {st['board']!r}, expected {self.board!r}: "
                                           f"reprovision with --board {self.board}")
        return Result("status", True, f"board {st['board']}, version {st.get('version')}, "
                                      f"rssi {st.get('rssi')}, time_valid {st.get('time_valid')}")

    def switch_on(self, s):
        s.say("Move the switch UP (on).")
        bad = self._wait(s, "switch on", lambda st: st.get("switch") == "on" and st.get("mode") == "force_on"
                         and st.get("relay") is True, "switch on, force_on, relay on")
        return bad or self._see(s, "switch on", relay_on_question(self.board, "purple"))

    def switch_off(self, s):
        s.say("Move the switch DOWN (off).")
        bad = self._wait(s, "switch off", lambda st: st.get("switch") == "off"
                         and st.get("mode") == "force_off" and st.get("relay") is False,
                         "switch off, force_off, relay off")
        return bad or self._see(s, "switch off", relay_off_question(self.board, "purple"))

    def switch_auto(self, s):
        s.say("Move the switch to the CENTRE (auto).")
        bad = self._wait(s, "switch auto", lambda st: st.get("switch") == "auto"
                         and st.get("mode") in ("auto", "fallback"), "switch auto")
        return bad or Result("switch auto", True, f"mode {self.status.get('mode')}")

    def demand_on(self, s):
        s.say("Sending demand on…")
        s.send(demand(True, ttl_s=120))
        bad = self._wait(s, "demand on", lambda st: st.get("mode") == "auto" and st.get("relay") is True
                         and st.get("source") == "override", "auto, relay on, source override")
        return bad or self._see(s, "demand on", relay_on_question(self.board, "orange"))

    def demand_off(self, s):
        s.say("Sending demand off…")
        s.send(demand(False, ttl_s=60))
        bad = self._wait(s, "demand off", lambda st: st.get("mode") == "auto" and st.get("relay") is False,
                         "auto, relay off")
        return bad or self._see(s, "demand off", relay_off_question(self.board, "green"))

    def goes_to_fallback(self, s):
        s.say("Waiting for the demand to expire (60 s) and the fallback to take over…")
        bad = self._wait(s, "fallback", lambda st: st.get("mode") == "fallback", "mode fallback",
                         timeout=60 + 45)
        return bad or Result("fallback", True, f"relay {'on' if self.status.get('relay') else 'off'} "
                                               f"(schedule_known {self.status.get('schedule_known')})")

    def report(self) -> str:
        lines = [f"# Heatlink bench check: {'PASS' if self.ok else 'FAIL'}", "", f"Board `{self.board}`.", "",
                 "| Step | Result | Detail |", "|---|---|---|"]
        lines += [f"| {r.step} | {'pass' if r.ok else '**FAIL**'} | {r.detail} |" for r in self.results]
        if self.status:
            lines += ["", f"Last status: `{summary(self.status)}`"]
        return "\n".join(lines) + "\n"


def demand(on: bool, ttl_s: int) -> dict:
    return {"command": "demand", "on": on, "source": "override", "ttl_s": ttl_s, "by": BENCH}


def relay_on_question(board, colour):
    load = "J2 reads closed (under 1 Ω)" if board.startswith("pcb") else "the dummy LED is lit"
    return f"Did the relay click ON, {load}, and is the status LED {colour}?"


def relay_off_question(board, colour):
    load = "J2 reads open" if board.startswith("pcb") else "the dummy LED is dark"
    return f"Is the relay OFF, {load}, and the status LED {colour}?"


def summary(st: dict) -> str:
    keys = ("reason", "mode", "relay", "switch", "source", "demand_age_s", "board", "version", "rssi")
    return " ".join(f"{k}={st[k]}" for k in keys if k in st)
