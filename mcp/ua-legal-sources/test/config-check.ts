/**
 * Verifies that the repo's `.mcp.json` actually launches the server.
 *
 * This is not paranoia: the first version of that file failed twice over, and
 * both failures are invisible until a client tries to connect.
 *   1. `"type": "stdio"` was read as the executable name → ENOENT on "stdio".
 *   2. `"command": "node"` → ENOENT, because an MCP client spawns without a
 *      login shell and Node comes from a version manager that is not on PATH.
 *
 * So this test spawns the server exactly as a client would: the command taken
 * verbatim from `.mcp.json`, cwd set to the repo root, and PATH deliberately
 * stripped of the version manager.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const config = JSON.parse(
  readFileSync(join(repoRoot, ".mcp.json"), "utf8"),
) as {
  mcpServers: Record<string, { command: string; args?: string[] }>;
};

// The repo-root server is deliberately named with a `-dev` suffix so that
// developing here cannot collide with the plugin's bundled copy of the same
// server. The shipped one is covered by `npm run check-plugin`.
const NAME = "ua-legal-sources-dev";
const entry = config.mcpServers[NAME];
if (!entry) throw new Error(`.mcp.json has no ${NAME} server`);
console.log(`command from .mcp.json: ${entry.command} ${(entry.args ?? []).join(" ")}`);

const transport = new StdioClientTransport({
  command: entry.command,
  args: entry.args ?? [],
  cwd: repoRoot,
  // A deliberately minimal PATH: no mise, no shims. If the launcher cannot find
  // Node from here, it cannot find it when the desktop app spawns it either.
  env: { HOME: process.env.HOME ?? "", PATH: "/usr/bin:/bin" },
});

const client = new Client({ name: "config-check", version: "0.0.1" });
await client.connect(transport);
const { tools } = await client.listTools();
await client.close();

if (tools.length === 0) throw new Error("server exposed no tools");
console.log(`✔ .mcp.json launches the server; ${tools.length} tools exposed`);
