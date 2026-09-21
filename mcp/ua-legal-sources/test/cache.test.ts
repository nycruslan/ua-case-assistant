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
