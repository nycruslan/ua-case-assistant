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

MIN_NODE=20

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
  "$HOME/.volta/bin/node" \
  "$HOME/.asdf/shims/node" \
  "$HOME/.local/bin/node" \
  /opt/homebrew/bin/node \
  /usr/local/bin/node \
  /usr/bin/node
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
    echo "ua-legal-sources: Node 20 or newer is required. Found only $TOO_OLD." >&2
    exit 1
  fi
  echo "ua-legal-sources: Node.js not found. Install Node 20 or newer." >&2
  echo "  If Node is installed via a version manager, make sure its shims" >&2
  echo "  directory exists, or install Node system-wide." >&2
  exit 127
fi

if [ ! -f "$SERVER" ]; then
  echo "ua-legal-sources: bundle missing at $SERVER" >&2
  exit 1
fi

exec "$NODE" "$SERVER"
