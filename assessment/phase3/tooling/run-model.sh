#!/usr/bin/env bash
# Phase 3: one headless Claude Code run of the frozen prompt. No follow-ups, no retries.
#   run-model.sh <label> <model-id> <clone-dir> [artifacts-dir]
set -u
LABEL=$1
MODEL=$2
DIR=$3
ART=${4:-/c/Users/imady/ToptalArtifacts/phase3}
CLI="/c/Users/imady/.vscode/extensions/anthropic.claude-code-2.1.329-win32-x64/resources/native-binary/claude.exe"
FLAGS=(-p --model "$MODEL" --effort medium --permission-mode auto --setting-sources project,local
  --strict-mcp-config --mcp-config "$(cygpath -w "$ART/empty-mcp.json")" --disallowedTools WebSearch
  --output-format stream-json --verbose)

mkdir -p "$ART"
[ -f "$ART/empty-mcp.json" ] || printf '{"mcpServers":{}}' > "$ART/empty-mcp.json"
[ -f "$ART/prompt.txt" ] || { echo "missing $ART/prompt.txt"; exit 1; }
cd "$DIR" || exit 1
R="$ART/$LABEL"
{
  echo "label:    $LABEL"
  echo "model:    $MODEL"
  echo "effort:   medium"
  echo "cli:      $("$CLI" --version 2>&1)"
  echo "cwd:      $(pwd -W)"
  echo "head:     $(git rev-parse HEAD)"
  echo "dirty:    $(git status --short | wc -l) files before run"
  echo "prompt:   sha256 $(sha256sum "$ART/prompt.txt" | cut -d' ' -f1), $(wc -w < "$ART/prompt.txt") words, sent on stdin"
  echo "command:  claude ${FLAGS[*]} < prompt.txt"
  echo "start:    $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$R.run.txt"

"$CLI" "${FLAGS[@]}" < "$ART/prompt.txt" > "$R.transcript.jsonl" 2> "$R.stderr.txt"
code=$?

{
  echo "end:      $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "exit:     $code"
} >> "$R.run.txt"
git status --short > "$R.status.txt"
git add -A && git diff --cached --binary > "$R.diff"
git diff --cached --stat > "$R.diffstat.txt"
echo "$LABEL finished: exit=$code, $(wc -l < "$R.transcript.jsonl") transcript lines, diff: $(tail -1 "$R.diffstat.txt")"
