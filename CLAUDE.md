# Nakostat

DIY smart thermostat replacing a broken Nest + Heatlink.

## Subproject CLAUDE.md files

Read these only when the conversation turns to that area:

- **Pi UI** (Rust/egui, touch dial): `embedded/pi/CLAUDE.md`
- **ESP32 firmware** (boiler relay, sensors, OTA): `embedded/esp32/CLAUDE.md`
- **Infrastructure** (AWS CDK, IoT Core, DynamoDB, Alexa skill): `infra/CLAUDE.md`

## Always apply

- AWS production account profile: `AWS_PROFILE=nakom.is` or `AWS_PROFILE=nakom.is-admin`
- AWS sandbox account profile: `AWS_PROFILE=nakom.is-sandbox`
- British English throughout — colour, licence, realise, whilst, etc.
- Work on a feature branch, never directly on `main`.
- When implementation is complete, create a GitHub PR.

## Architecture overview

```
[Pi 5 + RC070S 7" touch] ←MQTT→ [AWS IoT Core]
        ↑                               ↓
  [ENS160+AHT21 sensor]        [Lambda / DynamoDB]
                                        ↓
[ESP32 boiler controller] ←MQTT→ [IoT Core]     [Alexa skill Lambda]
   + 3-way manual switch                              ↓
   (auto / off / on)                        [nakostat.nakomis.com]
```

## Key hardware

| Device | Role |
|--------|------|
| Raspberry Pi 5 | Touch-screen thermostat UI, temperature/air quality sensor host |
| RC070S (Elecrow 7" 1024×600) | Touch display |
| ENS160+AHT21 | CO₂/eCO₂/TVOC + temperature/humidity sensor (on Pi) |
| ESP32 (boiler unit) | Boiler relay controller; polls IoT message queue |
| 3-way rotary switch | Physical override: auto / off / on |
| Amazon Echo | Voice control ("Alexa, set the heating to 20 degrees") |

## Repo layout

```
nakostat/
├── 3d/          3D models for printed enclosures
├── docs/        Architecture diagrams and notes
├── embedded/
│   ├── pi/      Rust/egui touch UI + sensor daemon
│   └── esp32/   PlatformIO firmware for boiler controller
├── githooks/    Git hooks (drawio→svg, README TOC)
├── infra/       AWS CDK stacks
├── pcb/         PCB designs (Fritzing)
├── scripts/     Helper scripts
└── web/         React SPA — nakostat.nakomis.com dashboard
```

## ESP32 firmware conventions

Inherit from the bootboots project — read `../bootboots/embedded/CLAUDE.md` for the
full picture. Key points:
- PlatformIO, Arduino framework
- OTA via custom BLE/S3 flow (not Arduino OTA)
- WiFi credentials in NVS, not in code
- Secrets generated from SSM via `generate_secrets.py`, never committed
