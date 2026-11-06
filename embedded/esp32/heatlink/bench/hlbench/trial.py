"""Live-trial alerts (STAT-82): what's worth a person's attention in the heatlink's MQTT traffic.

Pure: feed() each message with the time it arrived, and tick() now and then, and both return the
alerts that have just started or just cleared. An alert is raised once, when its condition starts,
and cleared once, when it ends, so a week of heartbeats doesn't repeat it every minute.
"""

from dataclasses import dataclass, field

SILENT_S = 150          # /status is a heartbeat every 60 s: two missed is worth saying so
DEMAND_FRESH_S = 90     # the daemon sends demand every 30 s
DEMAND_SETTLE_S = 5     # a demand's effect is reported with the next status; give it a moment
WEAK_RSSI = -80         # dBm; cleared above WEAK_RSSI + 5
RELAY_ON_LONG_S = 4 * 3600


@dataclass(frozen=True)
class Alert:
    kind: str           # silent, link, board, fallback, disagree, rssi, relay_long, reboot, version
    level: str          # error, warn, info
    message: str
    cleared: bool = False

    def line(self) -> str:
        return f"{'cleared' if self.cleared else self.level}: {self.message}"


@dataclass
class Trial:
    silent_s: float = SILENT_S
    relay_on_long_s: float = RELAY_ON_LONG_S
    weak_rssi: int = WEAK_RSSI
    started: float | None = None    # when watching began: a heatlink silent from the start is silent too
    last_status: dict | None = None
    last_status_at: float | None = None
    demand: dict | None = None
    demand_at: float | None = None
    relay_on_since: float | None = None
    active: set = field(default_factory=set)

    def _raise(self, kind, level, message):
        if kind in self.active:
            return []
        self.active.add(kind)
        return [Alert(kind, level, message)]

    def _clear(self, kind, message):
        if kind not in self.active:
            return []
        self.active.discard(kind)
        return [Alert(kind, "info", message, cleared=True)]

    def _set(self, kind, on, level, raised, cleared):
        return self._raise(kind, level, raised) if on else self._clear(kind, cleared)

    def feed(self, kind: str, message: dict, now: float) -> list[Alert]:
        """kind is the topic's last part: status, commands or responses."""
        if kind == "commands" and message.get("command") == "demand" and isinstance(message.get("on"), bool):
            self.demand, self.demand_at = message, now
            return []
        if kind != "status":
            return []
        return self._status(message, now)

    def _status(self, s: dict, now: float) -> list[Alert]:
        out = self._clear("silent", "heatlink is reporting again")
        prev, self.last_status, self.last_status_at = self.last_status, s, now

        if prev is not None:
            up, prev_up = s.get("uptime_s"), prev.get("uptime_s")
            if isinstance(up, (int, float)) and isinstance(prev_up, (int, float)) and up < prev_up:
                out.append(Alert("reboot", "warn", f"heatlink restarted (uptime {prev_up} s, now {up} s)"))
            if s.get("version") != prev.get("version"):
                out.append(Alert("version", "info", f"version {prev.get('version')} → {s.get('version')}"))

        board = s.get("board", "")  # older firmware has no board field: only null means unknown
        out += self._set("board", board is None, "error",
                         "board is null: the heatlink drives no pins (reprovision with --board)",
                         "board is known again")
        out += self._set("fallback", s.get("mode") == "fallback", "warn",
                         "fallback: no fresh demand from the daemon, the heatlink is on its own schedule",
                         "back on the daemon's demand")

        demand_age = None if self.demand_at is None else now - self.demand_at
        disagree = (s.get("mode") == "auto" and demand_age is not None
                    and DEMAND_SETTLE_S <= demand_age <= DEMAND_FRESH_S
                    and s.get("relay") is not self.demand["on"])
        want = None if self.demand is None else ("on" if self.demand["on"] else "off")
        out += self._set("disagree", disagree, "error",
                         f"relay is {'on' if s.get('relay') else 'off'} but the daemon's demand is {want}",
                         "relay follows the demand again")

        rssi = s.get("rssi")
        if isinstance(rssi, (int, float)):
            if rssi < self.weak_rssi:
                out += self._raise("rssi", "warn", f"weak Wi-Fi: {rssi} dBm")
            elif rssi > self.weak_rssi + 5:
                out += self._clear("rssi", f"Wi-Fi back to {rssi} dBm")

        if s.get("relay") is True:
            if self.relay_on_since is None:
                self.relay_on_since = now
        else:
            self.relay_on_since = None
            out += self._clear("relay_long", "relay is off")
        return out + self._relay_long(now)

    def _relay_long(self, now):
        if self.relay_on_since is None or now - self.relay_on_since < self.relay_on_long_s:
            return []
        return self._raise("relay_long", "warn",
                           f"relay has been on for {(now - self.relay_on_since) / 3600:.1f} h")

    def link(self, text: str) -> list[Alert]:
        """A note from the watcher's own connection (link.py), not from the heatlink."""
        if text == "reconnected":
            return self._clear("link", "the watcher is connected again")
        return self._raise("link", "error", f"the watcher's own connection: {text}")

    def tick(self, now: float) -> list[Alert]:
        since = self.last_status_at if self.last_status_at is not None else self.started
        if since is None or "link" in self.active:   # while we can't hear, silence means nothing
            return self._relay_long(now)
        quiet = now - since
        out = []
        if quiet > self.silent_s:
            heard = "" if self.last_status_at is not None else " since the watcher started"
            out += self._raise("silent", "error", f"no status for {quiet:.0f} s{heard}: heatlink offline?")
        return out + self._relay_long(now)
