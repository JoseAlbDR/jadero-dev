#!/usr/bin/env bash
# PreToolUse(Edit|Write): on a wp/NN-* branch, code under a learning path may change only when
# docs/learning/wp-NN.md says `decision: recorded` (or `fast_path: known`). ADR-028, report 12.3, D-38.
set -euo pipefail
input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.path // ""')
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
rel="${file#"$root"/}"
# Only learning paths are gated.
case "$rel" in
  apps/api/*|apps/agent/*|apps/contact/*|apps/mcp/*|apps/gateway/*|apps/guard-classifier/*|packages/messaging/*|packages/ai/*|packages/agent/*|packages/contracts/*|infra/*|.github/workflows/*) ;;
  turbo.json|pnpm-workspace.yaml|packages/config/*|.dependency-cruiser.*|lefthook.yml|commitlint.config.*) ;;   # repo tooling: the learning content of WP-1
  *) exit 0 ;;
esac
branch=$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
[[ "$branch" =~ ^wp/([0-9]+)(-|$) ]] || exit 0   # not a WP branch: not gated (hotfixes, chores)
wp="${BASH_REMATCH[1]}"
explainer="$root/docs/learning/wp-$wp.md"
if [[ ! -f "$explainer" ]]; then
  echo "learning-gate: $rel is a learning path and docs/learning/wp-$wp.md does not exist. Run /learn-step first (or mark the step known: D-38 fast path)." >&2; exit 2
fi
if grep -Eq '^(decision: recorded|fast_path: known)' "$explainer"; then exit 0; fi
echo "learning-gate: docs/learning/wp-$wp.md has no 'decision: recorded' (or 'fast_path: known') yet. The owner decides before code lands in $rel." >&2
exit 2
