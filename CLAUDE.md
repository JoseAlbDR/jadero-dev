@AGENTS.md

# Claude-specific notes

- Default effort for learning WPs is high and the pace is the owner's: explain first, build in small visible steps, never batch a whole WP into one diff.
- Use plan mode before touching `infra/`, `.github/workflows/` or any `domain/` folder; show the plan to the owner.
- Delegate wide searches to the `Explore` subagent; run `@agent-reviewer` on every PR before asking the owner to review.
- Orchestrator pattern: stay lean and delegate per `.claude/rules/orchestration.md` (explainer-writer, implementer, cartographer, researcher, reviewer; `/step`, `/map`, `/wrap-wp`) without waiting to be asked; background agents that touch git run with `isolation: "worktree"`.
- `.claude/rules/` holds path-scoped rules that load when you edit matching files; `.claude/skills/` holds `/adr`, `/wp`, `/learn-step`, `/step`, `/map`, `/wrap-wp`, `/explain`; `.claude/agents/` holds the subagents.
- One hook matters: `learning-gate.sh` blocks edits under learning paths until the explainer has `decision: recorded`. A denied edit is the process working, not a bug to route around: run `/learn-step` or ask the owner. Security comes from Claude Code's permission settings (the `.env` deny in `.claude/settings.json`), the learning gate and the owner's review, plus a sandbox when the session runs in one (cloud sessions do; a local one may not). The repo adds no guard hooks.
- Personal overrides go in `CLAUDE.local.md` and `.claude/settings.local.json` (both gitignored).
