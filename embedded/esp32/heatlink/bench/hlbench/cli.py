"""hl-bench (STAT-82): watch the heatlink, run the bench check, or watch the live trial.

    hl-bench watch [--env sandbox|prod] [--thing T] [--log FILE]
    hl-bench check --board devkitc|devkitc-v1.1|pcb-v1 [--quick] [--report FILE] ...
    hl-bench trial [--notify] [--log FILE] ...
"""

import argparse
import json
import queue
import subprocess
import sys
import time
from datetime import datetime

from .steps import BENCH, Check, summary
from .trial import Trial

PROFILES = {"sandbox": "nakom.is-sandbox", "prod": "nakom.is"}
BOARDS = ("devkitc", "devkitc-v1.1", "pcb-v1")


def fmt(arrived: float, kind: str, body) -> str:
    """One line per message, for a person watching."""
    at = datetime.fromtimestamp(arrived).strftime("%H:%M:%S")
    if kind == "status" and isinstance(body, dict):
        return f"{at} status   {summary(body)}"
    if kind == "commands" and isinstance(body, dict):
        rest = {k: v for k, v in body.items() if k != "command"}
        return f"{at} command  {body.get('command')} {json.dumps(rest, separators=(',', ':'))}"
    if kind == "link":
        return f"{at} link     {body}"
    text = json.dumps(body, separators=(",", ":")) if isinstance(body, (dict, list)) else str(body)
    return f"{at} {kind:<8} {text}"


class Recorder:
    """Prints messages and appends them to a JSONL log."""

    def __init__(self, log: str | None, out=sys.stdout):
        self.log = open(log, "a", encoding="utf-8") if log else None  # noqa: SIM115 (open for the run)
        self.out = out

    def __call__(self, arrived, kind, body, show=True):
        if self.log:
            self.log.write(json.dumps({"at": arrived, "kind": kind, "body": body}) + "\n")
            self.log.flush()
        if show:
            print(fmt(arrived, kind, body), file=self.out, flush=True)


class LinkSession:
    """steps.Session over a Link."""

    POLL_S = 3

    def __init__(self, link, record: Recorder):
        self.link, self.record, self.foreign = link, record, 0

    def _take(self, timeout):
        arrived, kind, body = self.link.messages.get(timeout=timeout)
        mine = kind == "commands" and isinstance(body, dict) and body.get("by") == BENCH
        if kind == "commands" and isinstance(body, dict) and body.get("command") == "demand" and not mine:
            self.foreign += 1
        self.record(arrived, kind, body, show=not mine)
        return kind, body

    def expect(self, want, timeout):
        # What's already queued predates this step: record it, but don't let it pass the step.
        while True:
            try:
                self._take(0)
            except queue.Empty:
                break
        end, ask = time.monotonic() + timeout, 0.0
        while (now := time.monotonic()) < end:
            if now >= ask:
                self.send({"command": "get_status"})
                ask = now + self.POLL_S
            try:
                kind, body = self._take(min(0.5, end - now))
            except queue.Empty:
                continue
            if kind == "status" and isinstance(body, dict) and want(body):
                return body
        return None

    def send(self, command):
        self.link.send({**command, "by": BENCH})

    def ask(self, question):
        while True:
            answer = input(f"  {question} [y/n] ").strip().lower()
            if answer in ("y", "yes", "n", "no"):
                return answer.startswith("y")

    def say(self, text):
        print(f"» {text}", flush=True)

    def foreign_demands(self):
        return self.foreign


def notify(text):
    subprocess.run(["osascript", "-e", f"display notification {json.dumps(text)} with title \"nakostat heatlink\""],
                   check=False)


def run_trial(link, record: Recorder, alerts: Trial, notify_too=False, until=None):
    def show(found):
        for a in found:
            line = f"{datetime.now():%Y-%m-%d %H:%M:%S} ALERT {a.line()}"
            print(line, flush=True)
            record(time.time(), "alert", {"kind": a.kind, "level": a.level, "message": a.message,
                                          "cleared": a.cleared}, show=False)
            if notify_too and (a.level == "error" or a.cleared):
                notify(a.line())

    while until is None or time.time() < until:
        try:
            wait = 5 if until is None else max(0.05, min(5, until - time.time()))
            arrived, kind, body = link.messages.get(timeout=wait)
            record(arrived, kind, body)
            if kind == "link":
                show(alerts.link(body))
            elif isinstance(body, dict):
                show(alerts.feed(kind, body, arrived))
        except queue.Empty:
            pass
        show(alerts.tick(time.time()))


def parse(argv):
    p = argparse.ArgumentParser(prog="hl-bench", description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("watch", "check", "trial"):
        s = sub.add_parser(name)
        s.add_argument("--env", choices=PROFILES, default="sandbox")
        s.add_argument("--profile", help="AWS profile (default: nakom.is-sandbox or nakom.is, from --env)")
        s.add_argument("--thing", default="nakostat-heatlink")
        s.add_argument("--log", help="append every message to this JSONL file")
        if name == "check":
            s.add_argument("--board", choices=BOARDS, required=True)
            s.add_argument("--quick", action="store_true", help="skip the fallback step (about a minute)")
            s.add_argument("--report", help="markdown report (default bench-<thing>-<board>-<time>.md)")
        if name == "trial":
            s.add_argument("--notify", action="store_true", help="macOS notifications for errors")
    return p.parse_args(argv)


def main(argv=None):
    args = parse(argv)
    from .link import Link  # here, so the tests import this module without the AWS SDK
    link = Link(args.thing, args.profile or PROFILES[args.env]).open()
    record = Recorder(args.log)
    print(f"subscribed to {link.prefix}/# ({args.env})", flush=True)
    try:
        if args.cmd == "watch":
            while True:
                record(*link.messages.get())
        elif args.cmd == "trial":
            run_trial(link, record, Trial(started=time.time()), notify_too=args.notify)
        else:
            check = Check(args.board, fallback=not args.quick)
            ok = check.run(LinkSession(link, record))
            report = args.report or f"bench-{args.thing}-{args.board}-{datetime.now():%Y%m%d-%H%M}.md"
            with open(report, "w", encoding="utf-8") as f:
                f.write(check.report())
            print(f"{'PASS' if ok else 'FAIL'}: report in {report}")
            return 0 if ok else 1
    except KeyboardInterrupt:
        pass
    finally:
        link.close()
    return 0
