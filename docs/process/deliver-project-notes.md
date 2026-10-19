# Notes towards a `/deliver-project` skill

Running notes from nakostat STAT-69 (from 19 Oct 2026), the first project where Martin acts as
project manager and Claude does the development. At the end these become a skill (working name
`deliver-project`; Martin suggested `implement-project`). `/start-claude-project` covers greenfield
planning; this covers taking an existing, part-built, multi-discipline project to done.

## Phase 0: kick-off

- Martin's opening brief was short ("have a rummage, see if you have everything, I want a gerber, an
  STL and all the code"). Expect the brief to change in the first half hour as he thinks aloud; treat
  mid-turn messages as refinements, not interruptions. Here: "prototype on a breadboard first, gerber
  after I OK it", "notes for a skill", "I'm AFK, Echo me".
- Ask early whether he will be AFK. If so, agree the contact channel (Alexa `announce` via the
  `alexa` MCP) and the stop points up front.

## Phase 1: rummage (≈15 min)

What worked:
- Read the repo top-level docs yourself (README, PLAN, BOM, sub-CLAUDE.md) — cheap and essential.
- Fan out three parallel Explore agents (Sonnet): (1) the current repo's real implementation state
  vs. its docs, (2) and (3) each "reference" project Martin points at. Ask for file paths, ≤1000 words.
- In parallel, check the toolchain: `command -v` for everything, plus `/Applications` (KiCad's
  `kicad-cli` and OpenSCAD live inside app bundles, not on PATH), `~/esp`, `~/.platformio`.
- Check Plane for the project's open items, and `conversation-memory` for past decisions (here it
  recovered the boiler wiring analysis from a June session).
- Look for sibling repos that own part of the system (here: `pish` held the touch UI; the repo's own
  README was out of date about it).

Findings pattern worth reporting: what exists, what's broken (especially *integration seams*: topic
names, IAM policies, payload field names that don't match between components), what's missing,
what only Martin can do, small environment gaps, and the technical calls you've made on his behalf.

## Phase 2: decisions

- Make technical decisions yourself and state them; ask only product / physical-world / safety /
  spend questions. One AskUserQuestion with ≤4 questions, each with a recommended option.
- Good questions here: what "prototype OK" means (bench vs live trial), failure-mode behaviour
  (what the boiler does when the link drops), which parts he already has, scope of the enclosure.
- Martin has lots of parts; "just ask, I'll probably have it". Don't assume a shopping list.

## Phase 3: spec + plan + Plane

- Follow the kappa-warmer pattern: `docs/superpowers/specs/<date>-<topic>-design.md`, then
  `docs/superpowers/plans/<date>-<topic>.md`, an epic in Plane with the decisions in its description,
  and one child item per plan task.
- Pin every cross-component contract (topics, payloads, IAM) in the spec *before* fanning work out
  to parallel agents, so they can't drift.

## Gotchas met

- `.tool-versions` may pin a patch version that isn't installed; `ASDF_PYTHON_VERSION=<installed>`
  works around it for ad-hoc scripts.
- `find /` for a file can hang for minutes; use `mdfind -name` on macOS.
