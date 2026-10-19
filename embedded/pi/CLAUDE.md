# Pi sub-project

Raspberry Pi 5 code: sensor daemon (ENS160+AHT21 → MQTT + Unix socket).

## sensor-daemon

Rust binary at `embedded/pi/sensor-daemon/`. Builds to a binary named `nakostat` (deployed to `/opt/nakostat/nakostat` on the Pi).

### Feature flags

| Flag | Purpose |
|------|---------|
| *(none — default)* | Mock sensor; compile and test on any host |
| `real-sensor` | Real I²C drivers via `linux-embedded-hal`, `ens160`, `aht20-driver` |

### Host-side build & test

```bash
cd embedded/pi/sensor-daemon
cargo test                        # all unit tests, no hardware needed
cargo build                       # debug binary (mock sensor)
```

The binary is named `nakostat` (not `nakostat-sensor`).

### Cross-compile for Pi 5 (aarch64)

The toolchain (Rust 1.99.0, edition 2024) is pinned in
`sensor-daemon/rust-toolchain.toml`; rustup installs it — with the
`aarch64-unknown-linux-gnu` and `armv7-unknown-linux-gnueabihf` targets — on
first use, so no `rustup target add` is needed.

Prerequisites (one-time): a cross-linker.
```bash
brew install aarch64-unknown-linux-gnu   # macOS
sudo apt install gcc-aarch64-linux-gnu   # Debian/Ubuntu; then:
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc
```

The deploy script (see below) handles cross-compilation automatically.

Alternatively, for manual builds:
```bash
cd embedded/pi/sensor-daemon
cargo build --release \
  --target aarch64-unknown-linux-gnu \
  --features real-sensor
```

The binary lands at `target/aarch64-unknown-linux-gnu/release/nakostat`.

### Deploy to Pi

Use the automated deploy script from the repo root:

```bash
./scripts/deploy-nakostat-pi.sh pi@nakostat.local
```

This script will:
- Cross-compile the binary for aarch64 with real sensor drivers
- Create the `nakostat` user and group
- Set up `/etc/nakostat/certs` and `/var/log/nakostat` directories
- Copy the config template to `/etc/nakostat/nakostat.toml` (you'll need to edit it with your MQTT settings)
- Install the systemd service
- Prompt for AWS IoT certificate and key paths
- Enable and start the service

### Verify deployment

Check the service status:
```bash
ssh pi@nakostat.local sudo systemctl status nakostat
```

View logs:
```bash
# Systemd journal logs
ssh pi@nakostat.local sudo journalctl -u nakostat -f

# Application logs (also goes to file)
ssh pi@nakostat.local sudo tail -f /var/log/nakostat/nakostat.log
```

### Useful commands

```bash
# Tail systemd logs
journalctl -u nakostat -f

# Tail file logs
tail -f /var/log/nakostat/nakostat.log

# Check socket output (reading and {"type":"state"} lines)
nc -U /run/nakostat/sensor.sock

# Override log level without editing config
sudo RUST_LOG=debug systemctl restart nakostat
```

### Environment variable overrides

All config values can be overridden at runtime:

| Variable | Overrides |
|----------|-----------|
| `NAKOSTAT_MQTT_ENDPOINT` | `mqtt.endpoint` |
| `NAKOSTAT_MQTT_PORT` | `mqtt.port` |
| `NAKOSTAT_MQTT_CLIENT_ID` | `mqtt.client_id` |
| `NAKOSTAT_MQTT_CERT_PATH` | `mqtt.cert_path` |
| `NAKOSTAT_MQTT_KEY_PATH` | `mqtt.key_path` |
| `NAKOSTAT_MQTT_TOPIC` | `mqtt.topic` |
| `NAKOSTAT_SENSOR_I2C_BUS` | `sensor.i2c_bus` |
| `NAKOSTAT_SENSOR_PUBLISH_INTERVAL_S` | `sensor.publish_interval_s` |
| `NAKOSTAT_SENSOR_WARMUP_S` | `sensor.warmup_s` |
| `NAKOSTAT_SOCKET_PATH` | `socket.path` |
| `NAKOSTAT_SCHEDULE_PATH` | `schedule.path` |
| `NAKOSTAT_MQTT_ENV` | `mqtt.env` |
| `NAKOSTAT_CONTROL_FROST_C` | `control.frost_c` |
| `NAKOSTAT_CONTROL_HYSTERESIS_BELOW_C` | `control.hysteresis_below_c` |
| `NAKOSTAT_CONTROL_HYSTERESIS_ABOVE_C` | `control.hysteresis_above_c` |
| `NAKOSTAT_CONTROL_MIN_CYCLE_S` | `control.min_cycle_s` |
| `NAKOSTAT_CONTROL_SETPOINT_JUMP_C` | `control.setpoint_jump_c` |
| `NAKOSTAT_CONTROL_STALE_AFTER_S` | `control.stale_after_s` |
| `NAKOSTAT_CONTROL_DEMAND_INTERVAL_S` | `control.demand_interval_s` |
| `NAKOSTAT_CONTROL_STATE_INTERVAL_S` | `control.state_interval_s` |
| `NAKOSTAT_CONTROL_STATE_PATH` | `control.state_path` |
| `NAKOSTAT_CONTROL_ALLOW_MOCK_DEMAND` | `control.allow_mock_demand` (mock-sensor builds refuse to send demand unless `true`; bench testing only) |
| `NAKOSTAT_HEATLINK_THING` | `heatlink.thing` |
| `NAKOSTAT_HEATLINK_TZ` | `heatlink.tz` |
| `NAKOSTAT_HEATLINK_COMFORT_C` | `heatlink.comfort_c` |
| `NAKOSTAT_HEATLINK_DUTY_PCT` | `heatlink.duty_pct` |
| `NAKOSTAT_HEATLINK_DEMAND_TTL_S` | `heatlink.demand_ttl_s` |
| `NAKOSTAT_HEATLINK_SCHEDULE_PUSH_INTERVAL_S` | `heatlink.schedule_push_interval_s` |

An unparseable numeric override is ignored with a warning.

### Control loop (STAT-51, STAT-47)

The daemon is the brain; the heatlink is a switch with a watchdog. Module map:

| Module | Role |
|--------|------|
| `control.rs` | Pure, clock-injected controller: effective setpoint (off → frost 7 °C; else override until the next schedule transition; else schedule), hysteresis (on < SP−0.3, off ≥ SP+0.2), 3-min short-cycle guard (bypassed by a ≥1 °C setpoint move), stale sensor (> 5 min) → no demand. Mode + override persisted to `control.state_path`. |
| `messages.rs` | Topics and payloads, exactly as the spec (`docs/superpowers/specs/2026-10-19-heatlink-v2-prototype-design.md`). |
| `daemon.rs` | Event handling: MQTT messages in → demand / `set_schedule` / `pi/state` / `pi/schedule` out, plus socket lines. |
| `link.rs` | Pure MQTT link state (disconnected → subscribing → ready): nothing is published while disconnected; the one SUBSCRIBE is retried every 10 s until a SubAck; the connect pushes happen on the SubAck. |
| `main.rs` | Timers and the event loop only. |

Subscribes to `nakostat/{env}/api/{setpoint,mode,schedule}`, `nakostat/{env}/pish/setpoint`
and `nakostat/{thing}/status`. Publishes `demand` to `nakostat/{thing}/commands` every 30 s and
on change (with `ts`, Unix seconds), `set_schedule` on connect / schedule change / mode change /
every 6 h (`enabled: false` while mode is off, so the heatlink's fallback stays off), `pi/state` every 60 s and on
change, `pi/schedule` on change and hourly. Readings are published only after the ENS160
warm-up, but the control loop uses the AHT21 temperature from the first read. A setpoint received
while off switches the mode back to heat. A mock-sensor build never sends demand unless
`control.allow_mock_demand` is set.

The socket carries reading lines (unchanged) and `{"type":"state",…}` lines (the `pi/state` object).
