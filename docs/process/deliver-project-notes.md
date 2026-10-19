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

## Phase 4: fan-out

- Before branching, `git fetch` and rebase onto `origin/main`: the local `main` was several merged PRs
  behind, which hid finished work (STAT-46 schedule persistence, STAT-60 tests).
- Fold existing Plane items into the epic (`update_work_item parent=…`) rather than duplicating them.
  Comment on items the new work supersedes, but leave closing them to Martin.
- Epic branch holds spec + plan; one worktree per workstream under `../<repo>-wt/<branch>`, created
  by the lead (not `isolation: worktree`) so each branches from the epic branch with a Plane-ref name.
  Workstream PRs target the epic branch; one epic PR goes to `main` at the end.
- Each agent prompt: worktree path, "read the spec fully, contracts are binding", the reference
  project to copy, exact verify commands, commit/PR conventions (no Co-Authored-By per Martin's
  CLAUDE.md, which overrides the harness attribution reminder), "never deploy/flash/provision", and a
  word-capped final report with "contract deviations" and "what Martin must do".
- Tell concurrent agents which files the *other* agents own (e.g. infra vs Alexa both touching
  `infra/bin/nakostat.ts`) to keep merges small.
- Model choice: inherit (Opus) for firmware/daemon/infra/Alexa; Sonnet for web, Pish widget.
- **Resource caps are mandatory in every agent prompt.** Martin runs many Claude sessions on one Mac;
  parallel agents running uncapped suites (jest spawned 17 workers × ~500 MB) pushed load to 15 and
  swap to 11/12 GB and another session had to ask us to stop. Always specify: `jest --maxWorkers=2`,
  `vitest run --maxWorkers=2` (Vitest 4; `--poolOptions` was removed), `cargo -j 2`, `idf.py`/ninja `-j2`, no
  parallel suites within an agent, full-suite runs once at the end. Prefer ≤3 heavy agents at once.
- Lead does the cross-cutting docs (wiring guide, CI) in its own worktree while agents run.

## Phase 5: integrate and review

- Merge workstream PRs into the epic branch as they land (the epic PR to `main` is Martin's gate);
  run the combined test suites after merging overlapping areas (infra + Alexa both touched infra/).
- Two reviewers with *different focuses* beat one reviewer on a 14k-line diff: (1) safety-critical
  control path + cross-component contracts, (2) user-facing surfaces (API, web, Alexa). Ask each to
  trace messages end to end and to list what it "declined to judge".
- Reviews found real cross-cutting bugs no single workstream could see: "mode off" not reaching the
  heatlink's fallback; demands replayed after an MQTT outage; no watchdog on the relay task. Budget
  for a fix round; amend the spec first when a fix changes a contract, then fan the fixes out again.
- Check reviewer severity against facts before acting (e.g. "any pool user can control the heating"
  was moot: the shared Cognito pool has self sign-up disabled), and record the downgrade.
- Hardware findings become steps in the bench-test procedure, not code (e.g. measure the relay IN pin).

## Gotchas met

- `.tool-versions` may pin a patch version that isn't installed; `ASDF_PYTHON_VERSION=<installed>`
  works around it for ad-hoc scripts.
- `find /` for a file can hang for minutes; use `mdfind -name` on macOS.
- A repo's documented git hooks may not be installed in a given clone (`core.hooksPath` was
  `.git/hooks`, not `githooks/`): render drawio → SVG by hand and check the commit's file list.
