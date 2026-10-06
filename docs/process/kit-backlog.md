# Kit backlog

Process changes in jadero-dev that still have to be ported to `project-kit`, or kit changes still to bring back here (`docs/process/project-kit.md`, "How it stays in sync"). One line per PR: the PR, the files, what to port. Clear a line in the PR that ports it.

- `chore/instructions-size-check`: `.claude/skills/wrap-wp/SKILL.md` step 8d, the always-loaded instructions line count (under 200 lines, Claude Code memory docs); port the same sentence to the kit's `/wrap-wp`.

Standing rule, not a port: when the ADR template, `/adr` or `scripts/adr/` change here, re-check the kit's `.claude/skills/domain-modeling/ADR-FORMAT.md` (`docs/process/project-kit.md`).
