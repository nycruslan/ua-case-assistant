/**
 * The hand-written MCP layer: argument validation. The protocol itself is
 * checked end to end with the official SDK client in protocol.ts and
 * plugin-check.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { validate, type ObjectSchema } from "../src/mcp.ts";

const schema: ObjectSchema = {
  type: "object",
  properties: {
    id: { type: "string", pattern: "^\\d{1,12}$" },
    query: { type: "string", minLength: 3, maxLength: 10 },
    mode: { type: "string", enum: ["head", "tail"] },
    semantic: { type: "boolean" },
    limit: { type: "integer", minimum: 1, maximum: 50 },
  },
  required: ["id"],
};

test("valid arguments pass, unknown keys are dropped", () => {
  assert.deepEqual(validate(schema, { id: "42", limit: 5, extra: "x" }), { args: { id: "42", limit: 5 } });
});

test("every rule is enforced, with the field named", () => {
  const error = (input: unknown) => (validate(schema, input) as { error: string }).error;
  assert.match(error({}), /«id»: обов'язковий/);
  assert.match(error({ id: "4a" }), /«id»: не відповідає формату/);
  assert.match(error({ id: "1", query: "ab" }), /«query»: щонайменше 3/);
  assert.match(error({ id: "1", query: "x".repeat(11) }), /«query»: щонайбільше 10/);
  assert.match(error({ id: "1", mode: "body" }), /«mode»: одне з: head, tail/);
  assert.match(error({ id: "1", semantic: "yes" }), /«semantic»: очікується true або false/);
  assert.match(error({ id: "1", limit: 2.5 }), /«limit»: очікується ціле число/);
  assert.match(error({ id: "1", limit: 51 }), /«limit»: щонайбільше 50/);
  assert.match(error({ id: 7 }), /«id»: очікується рядок/);
});

test("missing or malformed arguments are treated as empty, not a crash", () => {
  assert.match((validate(schema, undefined) as { error: string }).error, /«id»/);
  assert.match((validate(schema, ["42"]) as { error: string }).error, /«id»/);
});
