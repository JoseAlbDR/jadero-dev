---
name: wp
description: Start a work package. Checks the WP's dependencies and learning-gate status, creates the wp/NN-slug branch, and proposes the step list. Use at the start of any WP.
user-invocable: true
arguments: [wp]
allowed-tools: Read, Glob, Grep, Bash(git status*), Bash(git branch*), Bash(git switch *), Bash(git checkout -b *), Bash(git fetch*), Bash(git pull*), Bash(gh issue *), Bash(jq *), mcp__github__issue_read, mcp__github__list_issues, mcp__github__search_issues
---
Start WP-$wp.

1. Read the WP from `docs/plan/decisions.json` (`workPackages`, id `WP-$wp`): title, tag, size, release, dependsOn, deliverable, learns. Read its row in `docs/plan/report.md` section 14 and the ADRs it implements.
2. Check dependencies: for each `dependsOn` WP, find its GitHub issue by exact title prefix `WP-NN:` (`gh issue list --search "WP-NN:" --state all`, or the GitHub MCP tools when `gh` is not logged in) and report whether it is closed. If neither works, say so and ask the owner for the state; never guess. If a dependency is open, say so and stop unless the owner accepts the risk explicitly.
3. Check the gate: if `tag` is `learning`, look for `docs/learning/wp-$wp.md` and its `decision:` line. If missing or pending, the next step is `/learn-step $wp`, not code.
4. `git fetch origin && git switch -c wp/$wp-<slug> origin/main` (slug: short kebab-case of the title). If a dependency's PR is still open and the owner accepts starting on top of it, branch from that PR's branch instead, say so in the explainer's intro, and rebase onto `origin/main` as the first action after that PR merges.
5. Propose the step list: 4 to 8 small steps, each ending in a green `pnpm verify` and a commit; name which steps are learning steps and which the owner may mark `known` (D-38 fast path). For learning WPs, step 1 is always the explainer.
The last proposed step of every WP that changes code is "docs and map": update `docs/architecture/code-map.html` (its JSON data block) for any new app, package, module, provider, injection or request-path change, and republish its artifact when the session can publish artifacts.

6. Print the definition of done from the issue (its "Definition of done" section; when the issue cannot be read, the same text comes from `scripts/github/seed.mjs`, say which source you used). Mark items that cannot apply yet (staging and release-please arrive in WP-6 to WP-9) as n/a with the reason. Then stop for the owner's go.
