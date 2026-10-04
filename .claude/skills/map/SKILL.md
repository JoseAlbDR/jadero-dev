---
name: map
description: Bring the code map and the published artifacts up to date with the current branch by launching the cartographer agent. Use after a step that changes an app, package, module, provider, injection, request path or event, and as the last step of every WP that changes code.
user-invocable: true
arguments: []
allowed-tools: Read, Glob, Grep, Agent, Bash(git status*), Bash(git log*), Bash(git diff*)
---
Launch the `cartographer` agent for the current branch. Give it the branch name, the WP if any, and what changed (from `git diff origin/main...HEAD --stat`, or the last step's report).

It may run in the background while the conversation with the owner goes on, but it commits to this branch: do not run the implementer or any other agent that touches git at the same time unless one of them runs with `isolation: "worktree"`.

When it reports: check its commit exists on the branch (`git log -1`), then tell the owner in three lines what the map now shows that it did not, which artifacts were republished (with links from `docs/artifacts.md`), and any doubt it raised. Do not open or read `docs/architecture/code-map.html` in the main session.
