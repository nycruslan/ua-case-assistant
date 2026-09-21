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

find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  for candidate in \
    "$HOME/.local/share/mise/shims/node" \
    "$HOME/.local/bin/node" \
    /opt/homebrew/bin/node \
    /usr/local/bin/node
  do
    [ -x "$candidate" ] && { printf '%s\n' "$candidate"; return 0; }
  done
  # mise installed but not activated and not shimmed
  if [ -x "$HOME/.local/bin/mise" ]; then
    "$HOME/.local/bin/mise" which node 2>/dev/null && return 0
  fi
  return 1
}

NODE=$(find_node) || {
  echo "ua-legal-sources: Node.js not found. Node 24+ is required." >&2
  exit 127
}

MAJOR=$("$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$MAJOR" -lt 24 ]; then
  echo "ua-legal-sources: Node $("$NODE" -v) is too old; 24+ is required for native TypeScript." >&2
  exit 1
fi

# A fresh clone has no dependencies yet. Without this check Node throws
# ERR_MODULE_NOT_FOUND, and an MCP client shows only "server failed to connect".
if [ ! -d "$DIR/node_modules/@modelcontextprotocol" ]; then
  echo "ua-legal-sources: dependencies are not installed." >&2
  echo "  Run:  cd '$DIR' && npm install" >&2
  exit 1
fi

exec "$NODE" --experimental-strip-types "$DIR/src/index.ts"
