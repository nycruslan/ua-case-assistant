#!/bin/sh
# Launcher for the bundled ua-legal-sources MCP server.
#
# Why a script instead of "command": "node":
#   An MCP client spawns this without a login shell, so `node` is NOT on PATH
#   when Node comes from a version manager (mise, nvm, asdf, volta). A bare
#   `node` fails with ENOENT, and the client shows only "server failed to
#   connect". This resolves the interpreter itself.
#
# The server is a single pre-bundled file with no dependencies, so there is
# nothing to install. Node 20+ is enough.
#
# ☠️ This lives in scripts/, not bin/: a plugin's top-level bin/ directory
# cannot be distributed through claude.ai organization settings.

set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SERVER="$DIR/mcp/ua-legal-sources.mjs"

find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  for candidate in \
    "$HOME/.local/share/mise/shims/node" \
    "$HOME/.volta/bin/node" \
    "$HOME/.asdf/shims/node" \
    "$HOME/.local/bin/node" \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    /usr/bin/node
  do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  for mgr in "$HOME/.local/bin/mise" /opt/homebrew/bin/mise; do
    if [ -x "$mgr" ]; then
      "$mgr" which node 2>/dev/null && return 0
    fi
  done
  return 1
}

NODE=$(find_node) || {
  echo "ua-legal-sources: Node.js not found. Install Node 20 or newer." >&2
  echo "  If Node is installed via a version manager, make sure its shims" >&2
  echo "  directory exists, or install Node system-wide." >&2
  exit 127
}

MAJOR=$("$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$MAJOR" -lt 20 ]; then
  echo "ua-legal-sources: Node $("$NODE" -v) is too old; 20 or newer is required." >&2
  exit 1
fi

if [ ! -f "$SERVER" ]; then
  echo "ua-legal-sources: bundle missing at $SERVER" >&2
  exit 1
fi

exec "$NODE" "$SERVER"
