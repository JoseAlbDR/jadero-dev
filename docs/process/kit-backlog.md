# Kit backlog

Process changes in jadero-dev that still have to be ported to `project-kit`, or kit changes still to bring back here (`docs/process/project-kit.md`, "How it stays in sync"). One line per PR: the PR, the files, what to port. Clear a line in the PR that ports it.

- `chore/repetition-warmup-prepush`: `AGENTS.md` section 5 (repetition: recall a known pattern in a few lines and extend it), `.claude/skills/learn-step/SKILL.md` and `docs/learning/wp-template.md` (short recap instead of one sentence), `.claude/skills/step/SKILL.md` step 2 (warm-up recall question on the study backlog), `docs/learning/study-backlog.md` "How it is used", `lefthook.yml` (pre-push `pnpm verify`), `AGENTS.md` section 3 and `docs/local-playbook.md` (the hook and its skip). Port all of it.

(#104 and #105 are ported in project-kit#14.)

Standing rule, not a port: when the ADR template, `/adr` or `scripts/adr/` change here, re-check the kit's `.claude/skills/domain-modeling/ADR-FORMAT.md` (`docs/process/project-kit.md`).
