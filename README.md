# Nakostat

<!-- toc -->
<!-- tocstop -->

A DIY smart thermostat built after the Nest thermostat and Heatlink both failed.

## Hardware

| Device | Role |
|--------|------|
| Raspberry Pi 5 + RC070S 7" touch | Touch-screen UI |
| ENS160+AHT21 | Temperature, humidity, CO₂/eCO₂/TVOC |
| ESP32 | Boiler relay controller |
| 3-way rotary switch | Physical override: auto / off / on |
| Amazon Echo | Voice control via Alexa thermostat skill |

## Repo layout

| Directory | Contents |
|-----------|----------|
| `3d/` | Printed enclosure models |
| `docs/` | Architecture diagrams and notes |
| `embedded/pi/` | Rust/egui touch UI and sensor daemon |
| `embedded/esp32/` | PlatformIO ESP32 boiler firmware |
| `githooks/` | Pre-commit hooks |
| `infra/` | AWS CDK stacks |
| `pcb/` | PCB designs |
| `scripts/` | Helper scripts |
| `web/` | React dashboard (nakostat.nakomis.com) |

## Quick start

```bash
# Install git hooks
bash scripts/install-hooks.sh
```

## Related repos

- [`rotary-dial`](https://github.com/nakomis/rotary-dial) — egui thermostat dial widget (will be folded into `embedded/pi/`)
- [`esp32-bootstrap`](https://github.com/nakomis/esp32-bootstrap) — scaffolding tool used to initialise the ESP32 firmware project
