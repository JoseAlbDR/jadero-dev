#!/usr/bin/env bash
# PreToolUse(Edit|Write|MultiEdit|Bash): on a wp/NN-* branch, code under a learning path may change only
# when docs/learning/wp-N.md says `decision: recorded` (or `fast_path: known`). ADR-028, report 12.3, D-38.
# A detached HEAD fails closed: switch to a branch first (/wp creates wp/NN-slug). Named chore/, fix/ and
# docs/ branches (and any other named non-WP branch) are not gated. For Bash the check is best effort: a
# command is gated only when it looks like a write (redirect, tee, sed -i, cp, mv, rm, git apply...) and
# names a learning path.
set -euo pipefail
input=$(cat)
tool=$(printf '%s' "$input" | jq -r '.tool_name // ""')
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Learning paths (AGENTS.md section 5): directories, exact files, and file-name prefixes.
dirs='apps/(api|agent|contact|mcp|gateway|guard-classifier)|packages/(messaging|ai|agent|contracts|platform-nest|config)|templates|infra|\.github/workflows'
files='turbo\.json|pnpm-workspace\.yaml|lefthook\.yml'
prefixes='\.dependency-cruiser\.|commitlint\.config\.'

if [[ "$tool" == "Bash" ]]; then
  cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')
  # Make absolute and $CLAUDE_PROJECT_DIR paths look relative, then look for a write that names a learning path.
  cmd="${cmd//"$root"\//}"
  cmd="${cmd//\$\{CLAUDE_PROJECT_DIR\}\//}"
  cmd="${cmd//\$CLAUDE_PROJECT_DIR\//}"
  # Drop fd duplications and /dev/null redirects, which are not writes to a file.
  scrubbed=$(printf '%s' "$cmd" | sed -E 's/[0-9]*>&[0-9-]+//g; s/[0-9]*>>?[[:space:]]*\/dev\/null//g')
  write_re='(^|[[:space:]]|[;&|(])([0-9]?>>?[[:space:]]*[^&[:space:]=]|(tee|cp|mv|rm|install|rsync|truncate|touch|mkdir|ln|patch|dd)([[:space:]]|$)|sed[[:space:]]+(-[A-Za-z]*i|--in-place)|perl[[:space:]]+-[A-Za-z]*i|git[[:space:]]+(apply|restore|rm|mv)([[:space:]]|$)|git[[:space:]]+checkout[[:space:]]+(--|[^[:space:]]+[[:space:]]+--)[[:space:]])'
  path_re="(^|[[:space:]\"'=(])(\./)?(($dirs|$files)([^[:alnum:]_.-]|\$)|($prefixes))"
  printf '%s' "$scrubbed" | grep -Eq "$write_re" || exit 0
  printf '%s' "$scrubbed" | grep -Eq "$path_re" || exit 0
  rel="the path in this Bash command"
else
  file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.path // ""')
  rel="${file#"$root"/}"
  # Only learning paths are gated.
  [[ "$rel" =~ ^(($dirs)/|($files)$|($prefixes)) ]] || exit 0
fi

branch=$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ -z "$branch" || "$branch" == "HEAD" ]]; then
  echo "learning-gate: $rel is a learning path and HEAD is detached, so no work package can be read from the branch. Create a branch first (/wp NN makes wp/NN-slug; chore/, fix/ or docs/ for anything else)." >&2; exit 2
fi
[[ "$branch" =~ ^wp/([0-9]+)(-|$) ]] || exit 0   # not a WP branch: not gated (hotfixes, chores)
wp="${BASH_REMATCH[1]}"
explainer="$root/docs/learning/wp-$wp.md"
if [[ ! -f "$explainer" ]]; then
  echo "learning-gate: $rel is a learning path and docs/learning/wp-$wp.md does not exist. Run /learn-step first (or mark the step known: D-38 fast path)." >&2; exit 2
fi
if grep -Eq '^(decision: recorded|fast_path: known)' "$explainer"; then exit 0; fi
echo "learning-gate: docs/learning/wp-$wp.md has no 'decision: recorded' (or 'fast_path: known') yet. The owner decides before code lands in $rel." >&2
exit 2
