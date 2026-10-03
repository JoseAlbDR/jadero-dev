@AGENTS.md

# Claude-specific notes

- Default effort for learning WPs is high and the pace is the owner's: explain first, build in small visible steps, never batch a whole WP into one diff.
- Use plan mode before touching `infra/`, `.github/workflows/` or any `domain/` folder; show the plan to the owner.
- Delegate wide searches to the `Explore` subagent; run `@agent-reviewer` on every PR before asking the owner to review.
- `.claude/rules/` holds path-scoped rules that load when you edit matching files; `.claude/skills/` holds `/adr`, `/wp`, `/learn-step`, `/explain`.
- One hook matters: `learning-gate.sh` blocks edits under learning paths until the explainer has `decision: recorded`. A denied edit is the process working, not a bug to route around: run `/learn-step` or ask the owner. Security guardrails are the owner's framework's job, not this repo's.
- Personal overrides go in `CLAUDE.local.md` and `.claude/settings.local.json` (both gitignored).
