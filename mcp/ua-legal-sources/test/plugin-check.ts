/**
 * Verifies the BUNDLED server the plugin ships — the thing users actually run.
 *
 * It spawns it exactly as Claude Code will: the command read verbatim from the
 * plugin's own `.mcp.json`, with `${CLAUDE_PLUGIN_ROOT}` and
 * `${CLAUDE_PLUGIN_DATA}` substituted, and with PATH stripped of the version
 * manager so the launcher has to resolve Node itself.
 *
 * `npm test` covers the source; this covers the artifact. They can drift: the
 * bundle is a committed build output, so a source change that isn't rebuilt
 * would otherwise pass every other check.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const pluginRoot = join(repoRoot, "plugins", "ua-case-assistant");
const pluginData = join(tmpdir(), "ua-legal-plugin-check");

const config = JSON.parse(
  readFileSync(join(pluginRoot, ".mcp.json"), "utf8"),
) as {
  mcpServers: Record<
    string,
    { command: string; args?: string[]; env?: Record<string, string> }
  >;
};

const entry = config.mcpServers["ua-legal-sources"];
if (!entry) throw new Error("plugin .mcp.json has no ua-legal-sources server");

const expand = (s: string) =>
  s
    .replaceAll("${CLAUDE_PLUGIN_ROOT}", pluginRoot)
    .replaceAll("${CLAUDE_PLUGIN_DATA}", pluginData);

const command = expand(entry.command);
console.log(`command: ${entry.command}`);
console.log(`      → ${command}`);

// Guard against a stale bundle: it must be newer than the newest source file.
const bundle = join(pluginRoot, "mcp", "ua-legal-sources.mjs");
const srcDir = join(import.meta.dirname, "..", "src");
const newestSrc = Math.max(
  ...readdirSync(srcDir).map((f) => statSync(join(srcDir, f)).mtimeMs),
);
if (statSync(bundle).mtimeMs < newestSrc) {
  throw new Error(
    "the bundle is older than src/ — run `npm run build` before shipping",
  );
}
console.log(`bundle: ${(statSync(bundle).size / 1024 / 1024).toFixed(2)} MB, newer than src ✓`);

const transport = new StdioClientTransport({
  command,
  args: (entry.args ?? []).map(expand),
  cwd: repoRoot,
  // No mise, no shims: the launcher must find Node on its own.
  env: {
    HOME: process.env.HOME ?? "",
    PATH: "/usr/bin:/bin",
    ...Object.fromEntries(
      Object.entries(entry.env ?? {}).map(([k, v]) => [k, expand(v)]),
    ),
  },
});

const client = new Client({ name: "plugin-check", version: "0.0.1" });
await client.connect(transport);
const { tools } = await client.listTools();

// The bundle must expose the same surface as the source.
const expected = [
  "rada_resolve",
  "rada_status",
  "rada_unit",
  "rada_list_units",
  "lpd_search",
  "lpd_position",
  "lpd_digest_search",
  "edrsr_search",
  "edrsr_document",
  "case_status_instructions",
];
const names = tools.map((t) => t.name).sort();
const missing = expected.filter((e) => !names.includes(e));
if (missing.length) throw new Error(`bundle is missing tools: ${missing.join(", ")}`);

// And a no-network tool call must work through the bundle.
const res = await client.callTool({
  name: "case_status_instructions",
  arguments: {},
});
const parsed = JSON.parse(
  (res.content as { type: string; text: string }[])[0].text,
);
if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
  throw new Error("case_status_instructions returned no steps");
}

await client.close();
console.log(`✔ bundled plugin server OK — ${tools.length} tools, tool call works`);
