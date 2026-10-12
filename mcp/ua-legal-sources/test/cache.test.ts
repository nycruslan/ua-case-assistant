/**
 * Disk cache tests, against a throwaway directory.
 */
import { test } from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The cache reads its directory at import time, so set it before importing.
const dir = mkdtempSync(join(tmpdir(), "ua-cache-test-"));
process.env.UA_LEGAL_CACHE_DIR = dir;
const { readCache, writeCache } = await import("../src/cache.ts");
test.after(() => rmSync(dir, { recursive: true, force: true }));

test("a written entry reads back, and an old one expires", async () => {
  await writeCache("k", { body: "текст", fetchedAt: new Date(Date.now() - 60_000).toISOString() });
  assert.equal((await readCache("k"))?.body, "текст");
  assert.equal(await readCache("k", 1_000), undefined);
});

test("a truncated or foreign file is a miss, not a crash", async () => {
  // Same naming as cache.ts, so the junk lands exactly where "probe" lives.
  const file = join(dir, createHash("sha256").update("probe").digest("hex").slice(0, 32) + ".json");
  for (const junk of ["{not json", "null", '{"body":5,"fetchedAt":"x"}', '{"body":"x"}']) {
    writeFileSync(file, junk);
    assert.equal(await readCache("probe"), undefined, junk);
  }
});

test("an unexpanded or relative cache variable falls back to the home cache", async () => {
  // ☠️ A client that does not expand ${CLAUDE_PLUGIN_DATA} hands over the literal.
  const { cacheRoot } = await import("../src/cache.ts");
  const home = cacheRoot({});
  assert.match(home, /\.cache\/ua-legal-sources$/);
  assert.equal(cacheRoot({ UA_LEGAL_CACHE_DIR: "${CLAUDE_PLUGIN_DATA}/cache" }), home);
  assert.equal(cacheRoot({ UA_LEGAL_CACHE_DIR: "relative/cache" }), home);
  assert.equal(cacheRoot({ UA_LEGAL_CACHE_DIR: "/data/plugin/cache" }), "/data/plugin/cache");
  // The plugin's own data directory, which Claude Code exports to the server.
  assert.equal(cacheRoot({ CLAUDE_PLUGIN_DATA: "/home/u/.claude/plugins/data/x" }), "/home/u/.claude/plugins/data/x/cache");
  assert.equal(cacheRoot({ CLAUDE_PLUGIN_DATA: "${CLAUDE_PLUGIN_DATA}" }), home);
});

test("an entry is served from memory when the disk copy is gone", async () => {
  await writeCache("mem", { body: "у пам'яті", fetchedAt: new Date().toISOString() });
  rmSync(dir, { recursive: true, force: true });
  assert.equal((await readCache("mem"))?.body, "у пам'яті");
});
