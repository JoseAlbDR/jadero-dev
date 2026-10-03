/**
 * Architecture fitness functions (ADR-024). `pnpm depcruise` checks every import under `apps/` and
 * `packages/` against these rules; `pnpm verify` runs it through Turborepo (`//#depcruise`).
 *
 * Paths are regular expressions matched against paths relative to the repo root, for example
 * `apps/api/src/modules/content/domain/post.ts`. In a `to` pattern, `$1`, `$2`, ... stand for the
 * groups the `from` pattern captured, which is how a rule says "the same app" or "the same module".
 * Keep every group in a `from` pattern non-optional: dependency-cruiser drops unmatched groups,
 * which would shift the numbers.
 *
 * @type {import("dependency-cruiser").IConfiguration}
 */

/** Files that live outside the import graph on purpose (config files, declarations). */
const KNOWN_CONFIG_FILES = [
  "(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$",
  "\\.d\\.(c|m)?ts$",
  "(^|/)tsconfig[^/]*\\.json$",
  "(^|/)(vitest|vite|next|drizzle|commitlint)\\.config\\.(js|cjs|mjs|ts)$",
];

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment:
        "ADR-024: a dependency cycle makes load order matter and modules impossible to change " +
        "on their own. Break it with a port (an abstract class) or by moving the shared part down.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "domain-imports-only-domain",
      comment:
        "ADR-003: the domain layer is plain TypeScript. A file under src/modules/<m>/domain/ may " +
        "import only from the same module's domain/ folder and Node built-ins: no other layer, " +
        "no other module, no npm package.",
      severity: "error",
      from: { path: "^(apps|packages)/([^/]+)/src/modules/([^/]+)/domain/" },
      to: {
        pathNot: "^$1/$2/src/modules/$3/domain/",
        dependencyTypesNot: ["core"],
      },
    },
    {
      name: "application-never-imports-infrastructure",
      comment:
        "ADR-003: use cases depend on ports (abstract classes in application/ or domain/), never " +
        "on the adapters in infrastructure/. The module's wiring binds the adapter to the port.",
      severity: "error",
      from: { path: "^(apps|packages)/[^/]+/src/modules/[^/]+/application/" },
      to: { path: "^(apps|packages)/[^/]+/src/modules/[^/]+/infrastructure/" },
    },
    {
      name: "modules-import-through-index",
      comment:
        "ADR-003: a module's index.ts is its public surface. A file in src/modules/A/ may import " +
        "src/modules/B/ only through src/modules/B/index.ts, never a file inside it.",
      severity: "error",
      from: { path: "^(apps|packages)/([^/]+)/src/modules/([^/]+)/" },
      to: {
        path: "^$1/$2/src/modules/[^/]+/",
        pathNot: ["^$1/$2/src/modules/$3/", "^$1/$2/src/modules/[^/]+/index\\.ts$"],
      },
    },
    {
      name: "agent-and-ai-packages-never-import-nest-or-db",
      comment:
        "ADR-024 and AGENTS.md rule 6: packages/agent and packages/ai stay framework- and " +
        "storage-free, so the graph and the AI ports run and test without Nest or a database. " +
        "Persistence and DI live in apps/agent.",
      severity: "error",
      from: { path: "^packages/(agent|ai)/" },
      to: {
        path: [
          "(^|/)node_modules/(@nestjs/[^/]+|drizzle-orm|pg|postgres|@types/pg)/",
          "^(@nestjs/[^/]+|drizzle-orm|pg|postgres)(/|$)",
        ],
      },
    },
    {
      name: "shared-packages-hold-no-domain",
      comment:
        "AGENTS.md rule 5: shared packages hold infrastructure only. A package that imports from " +
        "apps/ is pulling a service's code (and its domain) into shared code.",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "no-orphans",
      comment:
        "A file nothing imports and that imports nothing is likely dead. Use it, delete it, or " +
        "add it to KNOWN_CONFIG_FILES if it is a config file.",
      severity: "warn",
      from: { orphan: true, pathNot: KNOWN_CONFIG_FILES },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(dist|coverage|\\.turbo|\\.next)/" },
    moduleSystems: ["es6", "cjs"],
    // Count `import type` too: a type-only import from infrastructure/ is still a layer violation.
    tsPreCompilationDeps: true,
    // The shared base compiler options; this wrapper only adds `include`, because the base has none
    // and TypeScript refuses a config with no input files (TS18003).
    tsConfig: { fileName: "tsconfig.depcruise.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
