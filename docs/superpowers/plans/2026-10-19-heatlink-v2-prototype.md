# Plan: heatlink v2 prototype (STAT-69)

Spec: `docs/superpowers/specs/2026-10-19-heatlink-v2-prototype-design.md`. The spec's topic and payload
contracts are binding on every workstream; if one must change, change the spec in the same PR and say so.

## Branching

The epic branch is `stat-69-heatlink-v2-prototype` (holds the spec and plan). Each workstream branches
from it and raises its PR **into the epic branch**. When all have landed, one epic PR goes to `main`.
Never enable auto-merge.

## Workstreams (run in parallel)

| # | Plane | Branch | Area | Done when |
|---|---|---|---|---|
| A | STAT-70 (supersedes 14, 16, 59) | `stat-70-heatlink-firmware` | `embedded/esp32/heatlink/` (new); delete `embedded/esp32/boiler/` | pytest on host passes; `idf.py build` succeeds; app under 90% of its slot; provisioning + flashing scripts and README |
| B | STAT-51 + STAT-47 | `stat-51-daemon-control-loop` | `embedded/pi/sensor-daemon/` | control loop, override, mode, demand + schedule push, `pi/state`, socket state lines; `cargo test`, clippy `-D warnings`, fmt, coverage ≥ 70% |
| C | STAT-71 | `stat-71-heatlink-infra` | `infra/` (except the Alexa stack) | Jest passes, `tsc`, Biome, `cdk synth` (sandbox) |
| D | STAT-24 + STAT-23 | `stat-24-alexa-skill` | `infra/lib/alexa-stack.ts`, `infra/lambda/alexa/`, `infra/skill-package/` | Jest for every directive; skill manifest; setup doc for Martin's steps |
| E | STAT-28 + STAT-48 | `stat-48-web-dashboard` | `web/` | Vitest passes, Biome, build; works against the new `/state` shape |
| F | STAT-72 | `stat-72-prototype-case` | `3d/heatlink-prototype/` | both STLs render via `make.sh`, manifold, and fit-checked against the parameters |
| G | STAT-73 | pish repo `stat-73-nakostat-state` | `pish/widgets/nakostat` | `cargo test --workspace`, clippy, PR into pish `main` |

Then, sequentially (Claude, after A–G):

| # | Plane | Work |
|---|---|---|
| H | STAT-74 | CI firmware job + OpenSCAD check; wiring guide + drawio; bench test procedure; README/CLAUDE.md refresh |
| I | — | Integration review (`superpowers:requesting-code-review`) of the epic branch; fix findings; sandbox deploy; epic PR to `main` |

## Stop points (Echo Martin)

- Anything that needs a prod deploy, a purchase, flashing hardware, or the Alexa developer console.
- A contract in the spec turns out to be unworkable.
- Firmware app over 90% of its OTA slot.

## Plane

Move each item to *In progress* when its workstream starts and to *Ready for test* when its PR is up
(link the PR). Done only when Martin merges.
