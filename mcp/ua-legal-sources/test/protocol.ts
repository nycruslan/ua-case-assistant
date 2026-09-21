/**
 * End-to-end MCP check: spawn the server over stdio, list its tools, and call
 * one that needs no network, so the protocol surface is verified independently
 * of the live sources.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    "--experimental-strip-types",
    join(import.meta.dirname, "..", "src", "index.ts"),
  ],
});

const client = new Client({ name: "smoke-client", version: "0.0.1" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`=== ${tools.length} tools registered ===`);
for (const t of tools) {
  const params = Object.keys(
    (t.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {},
  );
  console.log(`  ${t.name.padEnd(26)} (${params.join(", ") || "—"})`);
}

// A tool that needs no network — proves request/response plumbing works.
const res = await client.callTool({
  name: "case_status_instructions",
  arguments: { case_number: "522/2588/23" },
});
const text = (res.content as { type: string; text: string }[])[0].text;
const parsed = JSON.parse(text);
console.log("\n=== case_status_instructions ===");
console.log("why:", parsed.why.slice(0, 90) + "…");
console.log("steps:", parsed.steps.length);

await client.close();
console.log("\n✔ MCP protocol surface OK");
