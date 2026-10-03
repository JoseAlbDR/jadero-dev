---
paths:
  - "apps/api/**"
  - "apps/agent/**"
  - "apps/contact/**"
  - "apps/mcp/**"
  - "packages/platform-nest/**"
  - "templates/**"
---
# Nest code (WP-3 decision S1)

- A class that Nest injects through a constructor parameter is imported as a value: `import { ApiConfig } from "./api-config.js"`, never `import type`. With `verbatimModuleSyntax`, a type-only import is erased, the parameter's `design:paramtypes` metadata becomes `Object`, `tsc` stays green, and the app fails at boot with `Nest can't resolve dependencies of X (?)`.
- That is why `biome.json` turns `style/useImportType` off for these paths: its "safe fix" makes exactly that change, and the pre-commit hook would apply it. Outside these paths the rule stays on.
- The same override enables `unsafeParameterDecoratorsEnabled`, so Biome parses `@Body()`, `@Inject()` and friends.
- Relative imports carry `.js` (ESM, `module: NodeNext`); use `import.meta.dirname`, not `__dirname`.
- Read the environment only through the service's config (ADR-007): `loadConfig` from `@jadero/platform-nest` at boot, then the typed config class (`ApiConfig` in `api`) by injection. No `process.env` anywhere else.
