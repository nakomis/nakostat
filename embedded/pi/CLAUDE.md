# Pi sub-project

Raspberry Pi 5 code: sensor daemon (ENS160+AHT21 → MQTT + Unix socket).

## sensor-daemon

Rust binary at `embedded/pi/sensor-daemon/`.

### Feature flags

| Flag | Purpose |
|------|---------|
| *(none — default)* | Mock sensor; compile and test on any host |
| `real-sensor` | Real I²C drivers via `linux-embedded-hal`, `ens160`, `aht20-driver` |

### Host-side build & test

```bash
cd embedded/pi/sensor-daemon
cargo test                        # all 14 unit tests, no hardware needed
cargo build                       # debug binary (mock sensor)
```

### Cross-compile for Pi 5 (aarch64)

Prerequisites (one-time):
```bash
rustup target add aarch64-unknown-linux-gnu
brew install aarch64-unknown-linux-gnu   # or install the cross-linker manually
```

Build:
```bash
cargo build --release \
  --target aarch64-unknown-linux-gnu \
  --features real-sensor
```

The binary lands at `target/aarch64-unknown-linux-gnu/release/nakostat-sensor`.

Alternatively, use [cross](https://github.com/cross-rs/cross) which handles the
toolchain inside Docker:
```bash
cross build --release --target aarch64-unknown-linux-gnu --features real-sensor
```

### Deploy to Pi

```bash
PI=pi@nakostat.local   # adjust as needed

scp target/aarch64-unknown-linux-gnu/release/nakostat-sensor $PI:/tmp/
ssh $PI "sudo mv /tmp/nakostat-sensor /usr/local/bin/ && sudo chmod +x /usr/local/bin/nakostat-sensor"
```

### First-time setup on Pi

```bash
# Create user and group
sudo useradd -r -s /sbin/nologin nakostat
sudo usermod -aG i2c nakostat

# Config directory
sudo mkdir -p /etc/nakostat/certs
sudo cp sensor-daemon/config.toml.example /etc/nakostat/sensor.toml
# Edit /etc/nakostat/sensor.toml — fill in endpoint, client_id, etc.
# Copy AWS IoT cert and key into /etc/nakostat/certs/
sudo chown -R root:nakostat /etc/nakostat
sudo chmod 750 /etc/nakostat /etc/nakostat/certs
sudo chmod 640 /etc/nakostat/sensor.toml /etc/nakostat/certs/*

# Install and enable the systemd unit
sudo cp sensor-daemon/nakostat-sensor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nakostat-sensor
```

### Useful commands

```bash
# Tail logs
journalctl -u nakostat-sensor -f

# Check socket output (one reading per line)
nc -U /run/nakostat/sensor.sock

# Override log level without editing config
sudo RUST_LOG=debug systemctl restart nakostat-sensor
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
