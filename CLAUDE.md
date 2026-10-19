# Nakostat

DIY smart thermostat replacing a broken Nest + Heatlink.

## Subproject CLAUDE.md files

Read these only when the conversation turns to that area:

- **Pi UI** (Rust/egui, touch dial): `embedded/pi/CLAUDE.md`
- **Heatlink firmware** (ESP-IDF, relay, switch, Fleet OTA): `embedded/esp32/heatlink/README.md`
- **Infrastructure** (AWS CDK, IoT Core, DynamoDB, API): the design spec in `docs/superpowers/specs/`; Alexa skill setup: `docs/alexa-setup.md`

## Always apply

- AWS production account profile: `AWS_PROFILE=nakom.is` or `AWS_PROFILE=nakom.is-admin`
- AWS sandbox account profile: `AWS_PROFILE=nakom.is-sandbox`
- British English throughout — colour, licence, realise, whilst, etc.
- Work on a feature branch, never directly on `main`.
- When implementation is complete, create a GitHub PR.

## Testing

This project adopts a **test-first approach** wherever practical:

- Write tests before or alongside implementation, not as an afterthought.
- Every non-trivial function, module, or component should have unit tests.
- Integration/component tests for interactions between subsystems.
- Functional/end-to-end tests for user-visible behaviour.
- CI enforces a minimum **70% code coverage** across each sub-project. Aim higher.
- Heatlink firmware: keep logic in portable C under `embedded/esp32/heatlink/port/`, built natively and tested with pytest (`tests/`); the IDF glue in `esp32s3/main/` stays thin.
- Rust (Pi UI): `cargo test` + `cargo llvm-cov` for coverage.
- CDK/Lambda (TypeScript): Jest tests for CDK constructs and Lambda handlers.
- React (web): Vitest + React Testing Library for components; Playwright for functional tests.
- PRs cannot be merged to `main` unless all CI checks pass. Admins may bypass in emergencies.

## Architecture overview

```
 Pish (dial, separate repo) ─pish/setpoint─┐
 Web (nakostat.nakomis.com) ─API─► api/{setpoint,mode,schedule} ─┤
 Alexa Smart Home skill ─Lambda─► api/{setpoint,mode} ───────────┤
                                                                 ▼
          Pi sensor daemon (the brain: schedule, override, hysteresis)
             │ demand every 30 s, set_schedule          ▲ status
             ▼                                           │
     nakostat/nakostat-heatlink/commands      …/status, …/responses
             │                                           │
          Heatlink (ESP32-S3, ESP-IDF, Fleet OTA) ── relay ── boiler ROOM STAT/TIMER (230 V)
             ▲
          3-way switch (on / auto / off); falls back to a local schedule if demand stops
```

Contracts (topics, payloads): `docs/superpowers/specs/2026-10-19-heatlink-v2-prototype-design.md`.

## Key hardware

| Device | Role |
|--------|------|
| Raspberry Pi 5 | Touch-screen thermostat UI, temperature/air quality sensor host |
| RC070S (Elecrow 7" 1024×600) | Touch display |
| ENS160+AHT21 | CO₂/eCO₂/TVOC + temperature/humidity sensor (on Pi) |
| ESP32-S3 heatlink (boiler unit) | Relay on the boiler's 230 V `ROOM STAT/TIMER` pair; follows the daemon's demand, falls back to a local schedule |
| 3-way rotary switch | Physical override: auto / off / on |
| Amazon Echo | Voice control ("Alexa, set the heating to 20 degrees") |

## Repo layout

```
nakostat/
├── 3d/          3D models for printed enclosures
├── docs/        Architecture diagrams and notes
├── embedded/
│   ├── pi/      Rust/egui touch UI + sensor daemon
│   └── esp32/heatlink/   ESP-IDF firmware for the boiler heatlink
├── githooks/    Git hooks (drawio→svg, README TOC)
├── infra/       AWS CDK stacks
├── pcb/         PCB (Phase 2: generated in code, tinycrypt pipeline)
├── scripts/     Helper scripts
└── web/         React SPA — nakostat.nakomis.com dashboard
```

## ESP32 firmware conventions

The heatlink follows the kappa-warmer / tinycrypt pattern (not the old Arduino/esp32-bootstrap one).
Full details: `embedded/esp32/heatlink/README.md`.
- ESP-IDF 5.5 (`~/esp/v5.5/esp-idf`), ESP32-S3, no PSRAM, 4 MB partition table, 160 MHz.
- Fleet device: project `nakostat`, Thing `nakostat-heatlink`, topics `nakostat/<thing>/{commands,responses,status}`;
  OTA through Fleet with rollback; don't change Fleet's message shapes.
- Credentials (Wi-Fi, IoT endpoint, cert, key) live in the `prov` NVS partition, written by
  `scripts/provision-device.sh`; never in the image, never through CloudFormation.
- CI builds, and publishes to `s3://nakomis-firmware-{env}/nakostat/<version>/` on merge; bump
  `esp32s3/version.txt` with every firmware change.

## Hardware and wiring

- Prototype wiring, bench test and live-trial procedure: `docs/heatlink-prototype-wiring.md`.
- Prototype case: `3d/heatlink-prototype/` (OpenSCAD; `make.sh`).
- The boiler (Ideal Logic+ Combi) switches its call for heat at **230 V**; see `bom.md` §2 and §4.
