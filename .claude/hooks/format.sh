#!/usr/bin/env bash
# PostToolUse(Edit|Write): format the touched file with Biome when the repo has it (WP-1). Never fails the edit.
set -uo pipefail
input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')
[[ -z "$file" || ! -f "$file" ]] && exit 0
case "$file" in *.ts|*.tsx|*.js|*.mjs|*.json|*.jsonc) ;; *) exit 0 ;; esac
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
if [[ -f "$root/biome.json" || -f "$root/biome.jsonc" ]] && command -v pnpm >/dev/null 2>&1; then
  (cd "$root" && pnpm exec biome format --write "$file" >/dev/null 2>&1) || true
fi
exit 0
