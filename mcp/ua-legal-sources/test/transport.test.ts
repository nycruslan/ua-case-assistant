/**
 * Transport tests, without a network: a stream stands in for the response.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { gzipSync } from "node:zlib";

import { proxyFor, readBody } from "../src/transport.ts";

function response(encoding?: string) {
  return Object.assign(new PassThrough(), {
    headers: encoding ? { "content-encoding": encoding } : {},
  });
}

test("a compressed body is decompressed", async () => {
  const res = response("gzip");
  res.end(gzipSync(Buffer.from("Стаття 1.", "utf8")));
  assert.equal(await readBody(res), "Стаття 1.");
});

test("a connection dropped mid-way through a compressed body fails, not hangs", async () => {
  // ☠️ The regression: the decompressor never learned the response had died,
  // the request never settled, and the whole host queued behind it.
  const res = response("gzip");
  const whole = gzipSync(Buffer.from("x".repeat(50_000)));
  res.write(whole.subarray(0, 40));
  setTimeout(() => res.destroy(new Error("aborted")), 10);
  const outcome = await Promise.race([
    readBody(res).then(() => "resolved", () => "rejected"),
    new Promise((r) => setTimeout(() => r("hung"), 2_000)),
  ]);
  assert.equal(outcome, "rejected");
});

test("a compressed body cut short without an error fails, not hangs", async () => {
  const res = response("gzip");
  res.end(gzipSync(Buffer.from("y".repeat(50_000))).subarray(0, 40));
  await assert.rejects(readBody(res));
});

test("the proxy comes from HTTPS_PROXY and respects NO_PROXY", () => {
  const target = new URL("https://data.rada.gov.ua/laws/show/435-15.txt");
  assert.equal(proxyFor(target, {}), undefined);
  assert.equal(proxyFor(target, { HTTPS_PROXY: "proxy.local:3128" })?.host, "proxy.local:3128");
  assert.equal(
    proxyFor(target, { HTTPS_PROXY: "http://proxy.local:3128", NO_PROXY: "localhost,.rada.gov.ua" }),
    undefined,
  );
  assert.equal(proxyFor(target, { https_proxy: "http://p:1", no_proxy: "*" }), undefined);
});
