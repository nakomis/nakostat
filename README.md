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

## Toolchain versions

Every toolchain is pinned in [`.tool-versions`](.tool-versions), which is the single source of truth for local development and CI:

| Tool | Used by | How CI reads it |
|------|---------|-----------------|
| `nodejs` | `infra/`, `web/` | `actions/setup-node` with `node-version-file: .tool-versions` |
| `pnpm` | `infra/`, `web/` | `pnpm/action-setup` reads `packageManager` in `infra/package.json` and `web/package.json`; the **Toolchain pins** job fails if that disagrees with `.tool-versions` |
| `python` | PlatformIO (`embedded/esp32/`) | `actions/setup-python` with `python-version-file: .tool-versions` |
| `rust` | `embedded/pi/sensor-daemon/` | the `rust` line is passed to `dtolnay/rust-toolchain` |

With [asdf](https://asdf-vm.com/) (`nodejs`, `pnpm`, `python` and `rust` plugins) run `asdf install` in the repo root; with [mise](https://mise.jdx.dev/), `mise install`. PlatformIO has no asdf plugin, so it is pinned in [`embedded/esp32/requirements.txt`](embedded/esp32/requirements.txt) and installed into the pinned Python with `pip install -r embedded/esp32/requirements.txt`.

To bump a tool, change `.tool-versions` (and, for pnpm, `packageManager` in `package.json`) in the same PR.

## Lint and format

CI gates every sub-project on lint and formatting as well as tests. Run the same checks locally before pushing:

```bash
# web/ — Biome lint + format check
cd web && pnpm lint

# infra/ — type-check, then Biome at the version infra/biome.json declares
cd infra && pnpm exec tsc --noEmit && pnpm dlx @biomejs/biome@2.4.16 ci .
# auto-fix formatting and safe lint fixes:
cd infra && pnpm dlx @biomejs/biome@2.4.16 check --write .

# embedded/pi/sensor-daemon/ — rustfmt + clippy
cd embedded/pi/sensor-daemon && cargo fmt --check && cargo clippy --all-targets -- -D warnings
```

Keep the Biome version in `infra/biome.json`'s `$schema` equal to `web/biome.json`'s; the **Toolchain pins** job checks this. The ESP32 firmware has no lint gate yet: it has no `.clang-format`, and `pio check` would download the whole ESP32 toolchain on every run.

## Deployment versions

Infra deploys record their version in the shared nakomis deployment tracker (`api.infra.nakomis.com`, defined in [nakomis-infra](https://github.com/nakomis/nakomis-infra)) under the project key `nakostat-infra`. On a push to `main` the **Compute infra version** job reads the latest sandbox version from the tracker and bumps it — a line that is exactly `--bump-major` or `--bump-minor` in the merged commit message bumps that part, otherwise the patch. The same `infra/version.json` is deployed to sandbox and then prod, and each deploy is recorded after it succeeds. Recording is non-fatal, so a tracker outage never fails a deploy.

## Related repos

- [`rotary-dial`](https://github.com/nakomis/rotary-dial) — egui thermostat dial widget (migrating into `embedded/pi/`)
- [`esp32-bootstrap`](https://github.com/nakomis/esp32-bootstrap) — scaffolding tool used to initialise the ESP32 firmware project

## Licence

[CC0 1.0 Universal](LICENSE) — public domain dedication.

## Support

If you find this useful, please consider buying me a coffee:

[![Donate with PayPal](https://www.paypalobjects.com/en_GB/i/btn/btn_donate_SM.gif)](https://www.paypal.com/donate?hosted_button_id=Q3BESC73EWVNN&custom=nakostat)
