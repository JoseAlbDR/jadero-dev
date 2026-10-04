---
name: step
description: Run one implementation step of a work package under the step contract. The main session explains the step to the owner, delegates the build to the implementer agent, presents its report and asks one check question. Use for every implementation step after the decision is recorded, without the owner asking.
user-invocable: true
arguments: [wp, step]
allowed-tools: Read, Glob, Grep, Agent, Bash(git status*), Bash(git log*), Bash(git diff*), Bash(git show*), Bash(pnpm verify*)
---
Step $step of WP-$wp. The main session teaches and checks; the `implementer` agent builds.

1. **Gate.** `docs/learning/wp-$wp.md` says `decision: recorded` (or the step is `fast_path: known`) and the branch is `wp/$wp-*`. If not, the next action is `/learn-step $wp`.
2. **Explain before building**, in the chat, in a few plain lines: what the step builds and which pattern it is, with a small example from this project; the files; the explainer heading it implements (a concept `C<n>` or an option block); the ADR lines it touches. If the step was seen in an earlier WP, name it and say what is different. If the code would differ from an ADR or a recorded decision, stop and ask (`/adr` first for an ADR change).
3. **Delegate.** Launch the `implementer` agent in the foreground (it works on this branch, so nothing else may touch git meanwhile) with: WP and step, the title, the files, the explainer heading, the ADR lines, and anything the owner said about this step.
4. **Check the report** before presenting it: re-run `pnpm verify` on the branch, and look at `git show --stat HEAD` to confirm the commit matches the files claimed. If the implementer stopped with an open question, explain the question to the owner (problem, options, your recommendation after their answer) instead of continuing.
5. **Present** in the step contract's order: the demo output (short), the privacy check, the two step-log lines, the commit.
6. **One check question** on the mechanism just built, aimed at the likely misconception, usually "what happens when ..." on a failure or a change. Then wait. A wrong or partial answer is challenged on the spot per `AGENTS.md` section 5: what is right in it, the real behavior (the test or code line that proves it), why it was designed that way, the pattern name; note it in the step log. When the answer exposes a real gap in the code, propose the fix as the next small step.

Rule: a step that creates or changes a process (an app, a worker, a consumer, a `dev` script, compose) ends with a real `pnpm dev` run showing the process up. In a cloud session without Docker, give the owner the exact commands and wait for their output before the next step.

For a WP of size M or larger, after about half the steps, run the `reviewer` agent on the branch diff before the next step.
