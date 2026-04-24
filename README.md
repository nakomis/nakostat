# Nakostat

## Support

If you find this useful, please consider buying me a coffee:

[![Donate with PayPal](https://www.paypalobjects.com/en_GB/i/btn/btn_donate_SM.gif)](https://www.paypal.com/donate?hosted_button_id=Q3BESC73EWVNN&custom=nakostat)

<!-- toc -->
<!-- tocstop -->

A DIY smart thermostat built after the Nest thermostat and Heatlink both failed. Replaces both with a Raspberry Pi touch-screen UI, an ESP32 boiler relay controller, AWS IoT Core, and an Alexa thermostat skill.

## Hardware

| Device | Role |
|--------|------|
| Raspberry Pi 5 + RC070S 7" touch | Touch-screen UI (1024×600, egui) |
| ENS160+AHT21 | Temperature, humidity, CO₂/eCO₂/TVOC |
| ESP32 | Boiler relay controller |
| 3-way rotary switch | Physical override: auto / off / on |
| Amazon Echo | Voice control via Alexa thermostat skill |

## Architecture

```
[Pi 5 + RC070S 7" touch] ←MQTT→ [AWS IoT Core]
        ↑                               ↓
  [ENS160+AHT21 sensor]        [Lambda / DynamoDB]
                                        ↓
[ESP32 boiler controller] ←MQTT→ [IoT Core]     [Alexa skill Lambda]
   + 3-way manual switch                              ↓
   (auto / off / on)                        [nakostat.nakomis.com]
```

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

- [`rotary-dial`](https://github.com/nakomis/rotary-dial) — egui thermostat dial widget (migrating into `embedded/pi/`)
- [`esp32-bootstrap`](https://github.com/nakomis/esp32-bootstrap) — scaffolding tool used to initialise the ESP32 firmware project

## Licence

[CC0 1.0 Universal](LICENSE) — public domain dedication.

## Support

If you find this useful, please consider buying me a coffee:

[![Donate with PayPal](https://www.paypalobjects.com/en_GB/i/btn/btn_donate_SM.gif)](https://www.paypal.com/donate?hosted_button_id=Q3BESC73EWVNN&custom=nakostat)
