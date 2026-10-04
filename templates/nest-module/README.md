# Nest module template

Two module shapes for the Nest services (ADR-003, WP-3 decision G3). The files are real TypeScript: `pnpm verify` type-checks them, runs their tests and checks them against the architecture rules, so the template cannot drift from what the rules accept.

## Which shape

- **Layered** (`src/modules/notes/`): controller, application service, repository, `index.ts`. For modules with no rules worth protecting: health, revalidation, cv.
- **Hexagonal** (`src/modules/widgets/`): `domain/`, `application/` (use cases and ports), `infrastructure/` (adapters), `presentation/` (controllers), the module file and `index.ts`. For modules with rules: content, auth, knowledge, chat, usage, submissions.

## How to use it

1. Copy the folder of the shape you need into `apps/<service>/src/modules/<name>/`.
2. Rename `Note`/`Widget` and their files; keep the folder names and the `index.ts`.
3. Move request schemas to `packages/contracts` (ADR-006); bind real adapters (Drizzle from WP-10) in the module file.
4. Import the module in the service's `AppModule`; other modules import only from its `index.ts`.
5. Keep the tests next to the code: domain rules and use cases with fakes at the ports (ADR-009); Testcontainers for adapters that touch SQL.

## What the rules enforce here

| Rule (`.dependency-cruiser.cjs`) | What breaks it |
|---|---|
| `domain-imports-only-domain` | a `domain/` file importing Nest, Zod, any npm package or another layer |
| `application-never-imports-infrastructure` | a use case importing an adapter instead of its port |
| `modules-import-through-index` | another module importing a file inside this one |
| `no-circular` | two files importing each other, directly or not |

Nest specifics (`.claude/rules/nest.md`): classes that Nest injects are imported as values, never `import type`; relative imports end in `.js`.
