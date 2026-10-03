#!/usr/bin/env bash
# SessionStart: print the state an agent needs before its first action. Plain text goes into the context.
set -uo pipefail
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
branch=$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
echo "jadero.dev v2. Branch: $branch. Decisions: docs/adr/README.md. Plan and WPs: docs/plan/report.md section 14. Releases R0-R7, no dates."
if [[ "$branch" =~ ^wp/([0-9]+) ]]; then
  wp="${BASH_REMATCH[1]}"
  if [[ -f "$root/docs/learning/wp-$wp.md" ]]; then
    st=$(grep -Em1 '^(decision|fast_path):' "$root/docs/learning/wp-$wp.md" || echo "decision: pending")
    echo "WP-$wp explainer: docs/learning/wp-$wp.md ($st)."
  else
    echo "WP-$wp has no explainer yet: learning paths are locked until /learn-step runs and the owner records the decision."
  fi
fi
[[ -f "$root/package.json" ]] || echo "No code yet: the repo is documentation only until WP-1 merges."
exit 0
