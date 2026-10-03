/**
 * Commit message rules (ADR-024, ADR-025). Every commit is `type(scope): subject`, for example
 * `feat(agent): add hybrid retrieval`. release-please reads the type; the scope tells a reader
 * which part of the repo changed. A new package adds its scope here in the same pull request.
 */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      [
        "api",
        "agent",
        "contact",
        "mcp",
        "web",
        "admin",
        "contracts",
        "messaging",
        "platform-nest",
        "ai",
        "ui",
        "cv",
        "config",
        "infra",
        "ci",
        "docs",
        "adr",
        "learning",
        "agents",
        "github",
        "repo",
        "deps",
      ],
    ],
    "scope-empty": [2, "never"],
    "header-max-length": [2, "always", 100],
  },
};
