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

## Commands

```bash
npm run dev        # Vite dev server
npm run build      # tsc -b + vite build → dist/
npm test           # Vitest run + coverage (70% line gate)
npm run test:watch # Vitest watch mode
npm run lint       # Biome check (lint + format)
npm run format     # Biome format --write
npm run typecheck  # tsc -b
```

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
npx shadcn@latest add dialog
```

> ⚠️ **Lockfile / Nexus gotcha:** running `npm install` (directly or via the
> shadcn CLI) on a machine configured for the home Nexus proxy rewrites
> `package-lock.json` `resolved:` URLs to `packages.home.nakomis.com`, which
> 401s in CI (no mTLS client cert). After any install, reset them:
> ```bash
> sed -i '' 's|https://packages.home.nakomis.com/repository/npm-proxy/|https://registry.npmjs.org/|g' package-lock.json
> ```
