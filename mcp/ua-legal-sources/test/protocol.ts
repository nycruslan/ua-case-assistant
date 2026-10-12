/**
 * End-to-end MCP check: spawn the server over stdio, list its tools, and make
 * one call that is refused before any request, so the protocol surface is
 * verified independently of the live sources.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";

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

// Malformed input must get a JSON-RPC error, never end the server: valid JSON
// that is not a message, a batch holding one, and garbage.
const raw = spawn(process.execPath, ["--experimental-strip-types", join(import.meta.dirname, "..", "src", "index.ts")], {
  stdio: ["pipe", "pipe", "inherit"],
});
const replies = createInterface({ input: raw.stdout! })[Symbol.asyncIterator]();
const next = async () => JSON.parse((await replies.next()).value as string);
for (const [line, expected] of [["null", -32600], ["[null]", -32600], ["5", -32600], ["{not json", -32700]] as const) {
  raw.stdin!.write(`${line}\n`);
  const reply = await next();
  const error = Array.isArray(reply) ? reply[0].error : reply.error;
  if (error?.code !== expected) throw new Error(`${line}: expected ${expected}, got ${JSON.stringify(reply)}`);
}
raw.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" })}\n`);
if ((await next()).id !== 9) throw new Error("the server stopped answering after malformed input");
raw.stdin!.end();
console.log("=== malformed messages answered with errors; server still up ===");

console.log("\n✔ MCP protocol surface OK");
