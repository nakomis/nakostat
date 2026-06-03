# Nakostat web dashboard

React SPA for the Nakostat thermostat, served from S3 + CloudFront.

## Stack

| Concern | Tool |
|---------|------|
| Build / dev server | **Vite 8** |
| Framework | **React 19** |
| Language | **TypeScript 6** (`strict`) |
| Styling | **Tailwind CSS v4** (`@tailwindcss/vite`, CSS-first config) |
| Components | **shadcn/ui** (Radix primitives, owned in-repo) |
| Validation | **zod 4** |
| Tests | **Vitest 4** + Testing Library (jsdom) |
| Lint / format | **Biome 2** |
| Package manager | **pnpm** (pinned via `packageManager` in `package.json`) |

## Commands

```bash
pnpm install       # install deps (pnpm i)
pnpm dev           # Vite dev server
pnpm build         # tsc -b + vite build → dist/
pnpm test          # Vitest run + coverage (70% line gate)
pnpm test:watch    # Vitest watch mode
pnpm lint          # Biome check (lint + format)
pnpm format        # Biome format --write
pnpm typecheck     # tsc -b
```

> First time? `pnpm` is installed via `corepack` (or `npm i -g pnpm`); the exact
> version is pinned in `package.json`'s `packageManager` field.

## Folder & component conventions

```
src/
├── components/
│   ├── ui/        shadcn/ui primitives — VENDORED, do not hand-edit
│   └── …          app components (composed from ui/ primitives)
├── lib/
│   └── utils.ts   cn() helper (clsx + tailwind-merge)
├── test/
│   └── setup.ts   Vitest + jest-dom setup
├── App.tsx
├── main.tsx       app entry; imports index.css
└── index.css      Tailwind import + theme tokens (light/dark)
```

- **`@/` aliases `src/`** — import as `@/components/ui/button`, `@/lib/utils`. Configured in `vite.config.ts`, `tsconfig.*.json`, and `components.json`.
- **`src/components/ui/**` is owned but treated as vendored.** Add/update primitives with the CLI (`npx shadcn@latest add <name>`), don't hand-format them. Biome skips this folder (`biome.json` override) and it's excluded from coverage so regenerating a component never fights the linter or the gate.
- **App components** (everything outside `ui/`) are linted, formatted, and expected to carry tests.
- **Dark by default:** `<html class="dark">` in `index.html`. Theme tokens live in `index.css` (`:root` / `.dark`).

## Adding a shadcn component

```bash
pnpm dlx shadcn@latest add dialog
```

## Registry & lockfile

This project uses **pnpm** specifically so the lockfile stays registry-agnostic.

`pnpm-lock.yaml` records each package as `resolution: {integrity: <sha512>}` —
an integrity hash and version, **no hostname**. The registry is chosen from
config at install time:

- **Locally**, your global `~/.npmrc` points pnpm at the home Nexus proxy
  (`packages.home.nakomis.com`), so installs are served and cached from Nexus.
- **In CI**, there's no `~/.npmrc`, so pnpm resolves from `registry.npmjs.org`.

Both produce the *same* tree from the *same* committed lockfile — Nexus is a
byte-identical proxy of npmjs, so the integrity hashes match either way.

> This is why we don't use npm here. npm bakes the absolute `resolved:` URL
> (host **and** `/repository/npm-proxy/` path) into `package-lock.json`, so a
> lockfile generated against Nexus 401s in CI (no mTLS client cert). The old
> workaround was a manual `sed` to rewrite the host after every install; pnpm
> removes the problem entirely. `replace-registry-host` doesn't help — it swaps
> only the host, leaving Nexus's path, which 404s on npmjs.
