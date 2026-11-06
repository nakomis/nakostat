# hl-bench: watch, bench check and live-trial watcher

STAT-82. Talks to the heatlink over IoT Core from the Mac. It connects with SigV4 over WebSocket using
your AWS profile, so it needs no device certificate and doesn't clash with the heatlink's own
connection.

```bash
embedded/esp32/heatlink/venv/bin/pip install -r embedded/esp32/heatlink/bench/requirements.txt   # once
aws sso login --profile nakom.is-sandbox        # or nakom.is for --env prod
bench=embedded/esp32/heatlink/bench/hl-bench
py=embedded/esp32/heatlink/venv/bin/python
```

| Command | What it does |
|---|---|
| `$py $bench watch [--env prod] [--log f.jsonl]` | Prints every status, response and command on `nakostat/<thing>/#` |
| `$py $bench check --board <board> [--quick]` | The bench test, guided and checked, with a markdown report (below) |
| `$py $bench trial --env prod --notify --log trial.jsonl` | Watches the live trial and raises alerts (below) |

`--thing` defaults to `nakostat-heatlink`. `--env` (default `sandbox`) picks the profile:
`nakom.is-sandbox` or `nakom.is`. `--profile` overrides it.

## `check`

`check` follows the README's bench test. It tells you when to move the switch, sends the demands
itself, and checks each step against `/status`. It asks every few seconds and waits up to 20 s. Things
only you can see, like the relay clicking, the dummy LED or J2, and the status LED's colour, it asks
you about.

| Step | Checked |
|---|---|
| status | `board` is the one given, and the firmware is new enough to report it |
| switch on / off / auto | `switch`, `mode` (`force_on`, `force_off`, then `auto` or `fallback`) and `relay` |
| demand on / off | `auto`, with the relay following an `override` demand |
| fallback | After the 60 s demand expires, `mode:"fallback"`. Skip it with `--quick` |

It ends by sending demand off (ttl 60 s). The heatlink then falls back to its schedule.

**Stop the daemon first** (`sudo systemctl stop nakostat-sensor` on the Pi), or point the bench heatlink at
the other environment. The daemon sends demand every 30 s, and that would overrule the check. A
demand that `check` didn't send fails the check. It tells its own commands apart by `"by":"bench"`,
which the firmware ignores.

## `trial`

`trial` raises an alert once, when a condition starts, and clears it once, when it ends:

| Alert | When |
|---|---|
| silent (error) | No status for 150 s (the heartbeat is every 60 s), counting from when `trial` started |
| link (error) | The watcher's own connection is down, or its SSO session ran out. Silence isn't reported meanwhile |
| board (error) | `"board":null`: the heatlink drives no pins |
| disagree (error) | In `auto`, the relay doesn't match the daemon's latest demand, 5–90 s after it was sent |
| fallback (warn) | `mode:"fallback"`: the daemon has gone quiet |
| reboot (warn), version (info) | Uptime went backwards; the version changed (an OTA) |
| rssi (warn) | Wi-Fi under −80 dBm. It clears above −75 dBm |
| relay_long (warn) | The relay has been on for 4 h straight |

`--notify` sends a macOS notification for errors and for alerts clearing. `--log` keeps every message
and alert as JSONL. IoT Core drops a WebSocket connection after 24 hours, and reconnecting needs a live
SSO session. Run `aws sso login` once a day, or when you see a `link` line with "no AWS credentials".

The logic is in `hlbench/steps.py` and `hlbench/trial.py`, which are pure and tested by
`tests/test_bench.py`. The MQTT side is `hlbench/link.py`.
