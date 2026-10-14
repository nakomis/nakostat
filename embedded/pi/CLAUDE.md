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

# Check socket output (one reading per line)
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
