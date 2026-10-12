/**
 * The MCP stdio protocol for a tools-only server, without dependencies.
 *
 * Why not the official SDK: it pulled zod, ajv and their helpers into a 1.4 MB
 * bundle, while Anthropic's plugin directory inspects only readable files under
 * 256 KiB and holds anything larger for a reviewer on every release. A server
 * that only lists and calls tools needs four requests — initialize, ping,
 * tools/list, tools/call — so the protocol is spelled out here, matching the
 * SDK's behaviour (version negotiation, invalid input returned as a tool error
 * the model can correct). The tests drive it with the official SDK client.
 *
 * Messages are JSON-RPC 2.0, one per line on stdin/stdout. Nothing else may be
 * written to stdout.
 */
import { createInterface } from "node:readline";

/** Newest first; an unknown requested version gets the newest. */
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

/** The subset of JSON Schema the tools use — also what `validate` enforces. */
export interface PropertySchema {
  type: "string" | "boolean" | "integer";
  description?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
}

export interface ObjectSchema {
  type: "object";
  properties: Record<string, PropertySchema>;
  required?: string[];
}

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: ObjectSchema;
  annotations?: { readOnlyHint?: boolean; openWorldHint?: boolean };
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

/**
 * Check arguments against a tool's schema. Returns the cleaned arguments, with
 * unknown keys dropped, or a message naming the first problem.
 */
export function validate(
  schema: ObjectSchema,
  input: unknown,
): { args: Record<string, unknown> } | { error: string } {
  const given = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
  const args: Record<string, unknown> = {};
  for (const name of schema.required ?? []) {
    if (given[name] === undefined) return { error: `«${name}»: обов'язковий параметр.` };
  }
  for (const [name, rule] of Object.entries(schema.properties)) {
    const value = given[name];
    if (value === undefined) continue;
    const problem = check(rule, value);
    if (problem) return { error: `«${name}»: ${problem}` };
    args[name] = value;
  }
  return { args };
}

function check(rule: PropertySchema, value: unknown): string | undefined {
  if (rule.type === "boolean") {
    return typeof value === "boolean" ? undefined : "очікується true або false.";
  }
  if (rule.type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) return "очікується ціле число.";
    if (rule.minimum !== undefined && value < rule.minimum) return `щонайменше ${rule.minimum}.`;
    if (rule.maximum !== undefined && value > rule.maximum) return `щонайбільше ${rule.maximum}.`;
    return undefined;
  }
  if (typeof value !== "string") return "очікується рядок.";
  if (rule.minLength !== undefined && value.length < rule.minLength) {
    return `щонайменше ${rule.minLength} знаків.`;
  }
  if (rule.maxLength !== undefined && value.length > rule.maxLength) {
    return `щонайбільше ${rule.maxLength} знаків.`;
  }
  if (rule.pattern !== undefined && !new RegExp(rule.pattern).test(value)) {
    return `не відповідає формату ${rule.pattern}.`;
  }
  if (rule.enum !== undefined && !rule.enum.includes(value)) {
    return `одне з: ${rule.enum.join(", ")}.`;
  }
  return undefined;
}

interface Message {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

/**
 * Serve `tools` over stdin/stdout until stdin closes. `invalid` turns a bad
 * argument into the tool error the model sees, so it can correct the call.
 */
export function serve(
  info: { name: string; version: string; instructions: string },
  tools: Tool[],
  invalid: (message: string) => ToolResult,
): void {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);

  const handle = async (msg: Message): Promise<unknown> => {
    // ☠️ `null` or a number is valid JSON but not a message; reading `.id` off it
    // threw inside the line listener, and the unhandled rejection killed the
    // server for the rest of the session.
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
      return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } };
    }
    // A notification (no id) or a response to us: nothing to answer.
    if (msg.id === undefined || typeof msg.method !== "string") return undefined;
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
    const failure = (code: number, message: string) => ({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code, message },
    });

    switch (msg.method) {
      case "initialize": {
        const asked = msg.params?.protocolVersion;
        return reply({
          protocolVersion: PROTOCOL_VERSIONS.includes(asked as string) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: info.name, version: info.version },
          instructions: info.instructions,
        });
      }
      case "ping":
        return reply({});
      case "tools/list":
        return reply({
          tools: tools.map(({ name, title, description, inputSchema, annotations }) => ({
            name,
            title,
            description,
            // No $schema: MCP reads a schema without one as JSON Schema
            // 2020-12, and these keywords mean the same in every draft. A
            // schema URL in the bundle also reads as a remote host to the
            // plugin directory's scanner.
            inputSchema,
            annotations,
          })),
        });
      case "tools/call": {
        const tool = byName.get(String(msg.params?.name));
        if (!tool) return reply(invalid(`Інструмента «${String(msg.params?.name)}» немає.`));
        const checked = validate(tool.inputSchema, msg.params?.arguments);
        if ("error" in checked) return reply(invalid(checked.error));
        try {
          return reply(await tool.handler(checked.args));
        } catch (err) {
          // Handlers return their own errors; this is the last line of defence.
          return reply(invalid(`Внутрішня помилка: ${(err as Error).message}`));
        }
      }
      default:
        return failure(-32601, `Method not found: ${msg.method}`);
    }
  };

  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", async (line) => {
    if (!line.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    // Nothing thrown here may escape: an unhandled rejection ends the process.
    const answerOne = (m: unknown) =>
      handle(m as Message).catch((err: Error) => ({
        jsonrpc: "2.0",
        id: (m as Message | null)?.id ?? null,
        error: { code: -32603, message: `Internal error: ${err?.message ?? err}` },
      }));
    // Older protocol versions allow batches; answer them as a batch.
    if (Array.isArray(parsed)) {
      const answers = (await Promise.all(parsed.map(answerOne))).filter(Boolean);
      if (answers.length) send(answers);
      return;
    }
    const answer = await answerOne(parsed);
    if (answer) send(answer);
  });
  // The client closing stdin ends the session; background work must not keep
  // the process alive after it.
  lines.on("close", () => process.exit(0));
}
