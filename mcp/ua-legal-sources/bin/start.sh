#!/bin/sh
# Launcher for the ua-legal-sources MCP server.
#
# Exists for two reasons, both found the hard way:
#
#  1. An MCP client spawns this without a login shell, so `node` is NOT on PATH
#     when Node comes from a version manager (mise here). A bare
#     `"command": "node"` in .mcp.json fails with ENOENT.
#  2. Relative paths in .mcp.json resolve against the client's cwd, not the repo,
#     so the server entry point is resolved from this script's own location.
#
# Node 24+ is required: the server runs TypeScript directly, with no build step.

set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

MIN_NODE=24

# The first Node that is new enough wins. ☠️ Taking simply the first Node found
# let an old system or Homebrew Node shadow a current one from a version
# manager further down the list, and the server refused to start.
NODE=""
TOO_OLD=""
try_node() {
  [ -n "$NODE" ] && return 0
  [ -n "${1:-}" ] && [ -x "$1" ] || return 0
  major=$("$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null) || return 0
  if [ "$major" -ge "$MIN_NODE" ] 2>/dev/null; then
    NODE=$1
  elif [ -z "$TOO_OLD" ]; then
    TOO_OLD="$1 ($("$1" -v 2>/dev/null || echo "?"))"
  fi
  return 0
}

try_node "$(command -v node 2>/dev/null || true)"
for candidate in \
  "$HOME/.local/share/mise/shims/node" \
  "$HOME/.local/bin/node" \
  /opt/homebrew/bin/node \
  /usr/local/bin/node
do
  try_node "$candidate"
done
for mgr in "$HOME/.local/bin/mise" /opt/homebrew/bin/mise; do
  if [ -x "$mgr" ]; then try_node "$("$mgr" which node 2>/dev/null || true)"; fi
done
# nvm and fnm keep one directory per version and no shim: newest first.
# A here-document, not a pipe, so try_node runs in this shell and keeps NODE.
if [ -z "$NODE" ]; then
  versions=$(
    for c in \
      "$HOME"/.nvm/versions/node/v*/bin/node \
      "$HOME"/.local/share/fnm/node-versions/v*/installation/bin/node \
      "$HOME/Library/Application Support/fnm/node-versions"/v*/installation/bin/node
    do
      [ -x "$c" ] || continue
      printf '%s\t%s\n' "$(printf '%s\n' "$c" | sed 's|.*/v\([0-9][0-9.]*\)/.*|\1|')" "$c"
    done | sort -t . -k 1,1nr -k 2,2nr -k 3,3nr | cut -f 2-
  )
  while IFS= read -r candidate; do
    try_node "$candidate"
  done <<EOF
$versions
EOF
fi

if [ -z "$NODE" ]; then
  if [ -n "$TOO_OLD" ]; then
    echo "ua-legal-sources: Node 24+ is required for native TypeScript. Found only $TOO_OLD." >&2
    exit 1
  fi
  echo "ua-legal-sources: Node.js not found. Node 24+ is required." >&2
  exit 127
fi

# The server imports only Node's own modules, so a fresh clone runs without
# `npm install`; dependencies are for the tests and the build.
exec "$NODE" --experimental-strip-types "$DIR/src/index.ts"
