/**
 * End-to-end MCP check: spawn the server over stdio, list its tools, and make
 * one call that is refused before any request, so the protocol surface is
 * verified independently of the live sources.
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

// A call that is refused before any request — proves request/response plumbing
// and the error shape without touching a live source.
const res = await client.callTool({
  name: "edrsr_search",
  arguments: { case_number: "522/2588/23", date_from: "31.02.2024" },
});
const parsed = JSON.parse((res.content as { type: string; text: string }[])[0].text);
if (!res.isError || parsed.kind !== "input") {
  throw new Error(`expected an input error, got ${JSON.stringify(parsed)}`);
}
console.log("\n=== refused before any request ===");
console.log(parsed.error, "·", parsed.reminder);

await client.close();
console.log("\n✔ MCP protocol surface OK");
