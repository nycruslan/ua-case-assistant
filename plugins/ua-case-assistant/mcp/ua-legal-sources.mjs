// package.json
var package_default = {
  name: "ua-legal-sources",
  version: "0.7.2",
  description: "Local MCP server for Ukrainian legal sources (data.rada, \u0404\u0414\u0420\u0421\u0420, \u041B\u041F\u0414 \u0412\u0421).",
  scripts: {
    test: "node --experimental-strip-types --test test/*.test.ts",
    smoke: "node --experimental-strip-types test/smoke.ts",
    start: "node --experimental-strip-types src/index.ts",
    "check-config": "node --experimental-strip-types test/config-check.ts",
    "check-protocol": "node --experimental-strip-types test/protocol.ts",
    build: "esbuild src/index.ts --bundle --platform=node --format=esm --target=node20 --outfile=../../plugins/ua-case-assistant/mcp/ua-legal-sources.mjs --legal-comments=none",
    "check-plugin": "node --experimental-strip-types test/plugin-check.ts"
  },
  license: "Apache-2.0",
  type: "module",
  devDependencies: {
    "@modelcontextprotocol/sdk": "^1.32.1",
    "@types/node": "^26.6.5",
    esbuild: "^0.28.2",
    typescript: "^7.0.2"
  }
};

// src/mcp.ts
import { createInterface } from "node:readline";
var PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
function validate(schema2, input) {
  const given = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const args = {};
  for (const name of schema2.required ?? []) {
    if (given[name] === void 0) return { error: `\xAB${name}\xBB: \u043E\u0431\u043E\u0432'\u044F\u0437\u043A\u043E\u0432\u0438\u0439 \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440.` };
  }
  for (const [name, rule] of Object.entries(schema2.properties)) {
    const value = given[name];
    if (value === void 0) continue;
    const problem = check(rule, value);
    if (problem) return { error: `\xAB${name}\xBB: ${problem}` };
    args[name] = value;
  }
  return { args };
}
function check(rule, value) {
  if (rule.type === "boolean") {
    return typeof value === "boolean" ? void 0 : "\u043E\u0447\u0456\u043A\u0443\u0454\u0442\u044C\u0441\u044F true \u0430\u0431\u043E false.";
  }
  if (rule.type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) return "\u043E\u0447\u0456\u043A\u0443\u0454\u0442\u044C\u0441\u044F \u0446\u0456\u043B\u0435 \u0447\u0438\u0441\u043B\u043E.";
    if (rule.minimum !== void 0 && value < rule.minimum) return `\u0449\u043E\u043D\u0430\u0439\u043C\u0435\u043D\u0448\u0435 ${rule.minimum}.`;
    if (rule.maximum !== void 0 && value > rule.maximum) return `\u0449\u043E\u043D\u0430\u0439\u0431\u0456\u043B\u044C\u0448\u0435 ${rule.maximum}.`;
    return void 0;
  }
  if (typeof value !== "string") return "\u043E\u0447\u0456\u043A\u0443\u0454\u0442\u044C\u0441\u044F \u0440\u044F\u0434\u043E\u043A.";
  if (rule.minLength !== void 0 && value.length < rule.minLength) {
    return `\u0449\u043E\u043D\u0430\u0439\u043C\u0435\u043D\u0448\u0435 ${rule.minLength} \u0437\u043D\u0430\u043A\u0456\u0432.`;
  }
  if (rule.maxLength !== void 0 && value.length > rule.maxLength) {
    return `\u0449\u043E\u043D\u0430\u0439\u0431\u0456\u043B\u044C\u0448\u0435 ${rule.maxLength} \u0437\u043D\u0430\u043A\u0456\u0432.`;
  }
  if (rule.pattern !== void 0 && !new RegExp(rule.pattern).test(value)) {
    return `\u043D\u0435 \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u0430\u0454 \u0444\u043E\u0440\u043C\u0430\u0442\u0443 ${rule.pattern}.`;
  }
  if (rule.enum !== void 0 && !rule.enum.includes(value)) {
    return `\u043E\u0434\u043D\u0435 \u0437: ${rule.enum.join(", ")}.`;
  }
  return void 0;
}
function serve(info, tools2, invalid) {
  const byName = new Map(tools2.map((t) => [t.name, t]));
  const send = (message) => process.stdout.write(`${JSON.stringify(message)}
`);
  const handle = async (msg) => {
    if (msg.id === void 0 || typeof msg.method !== "string") return void 0;
    const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
    const failure = (code, message) => ({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code, message }
    });
    switch (msg.method) {
      case "initialize": {
        const asked = msg.params?.protocolVersion;
        return reply({
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: info.name, version: info.version },
          instructions: info.instructions
        });
      }
      case "ping":
        return reply({});
      case "tools/list":
        return reply({
          tools: tools2.map(({ name, title, description, inputSchema, annotations }) => ({
            name,
            title,
            description,
            // No $schema: MCP reads a schema without one as JSON Schema
            // 2020-12, and these keywords mean the same in every draft. A
            // schema URL in the bundle also reads as a remote host to the
            // plugin directory's scanner.
            inputSchema,
            annotations
          }))
        });
      case "tools/call": {
        const tool2 = byName.get(String(msg.params?.name));
        if (!tool2) return reply(invalid(`\u0406\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442\u0430 \xAB${String(msg.params?.name)}\xBB \u043D\u0435\u043C\u0430\u0454.`));
        const checked = validate(tool2.inputSchema, msg.params?.arguments);
        if ("error" in checked) return reply(invalid(checked.error));
        try {
          return reply(await tool2.handler(checked.args));
        } catch (err) {
          return reply(invalid(`\u0412\u043D\u0443\u0442\u0440\u0456\u0448\u043D\u044F \u043F\u043E\u043C\u0438\u043B\u043A\u0430: ${err.message}`));
        }
      }
      default:
        return failure(-32601, `Method not found: ${msg.method}`);
    }
  };
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", async (line) => {
    if (!line.trim()) return;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    if (Array.isArray(parsed)) {
      const answers = (await Promise.all(parsed.map((m) => handle(m)))).filter(Boolean);
      if (answers.length) send(answers);
      return;
    }
    const answer = await handle(parsed);
    if (answer) send(answer);
  });
  lines.on("close", () => process.exit(0));
}

// src/transport.ts
import { request as httpRequestRaw } from "node:http";
import { request as httpsRequest } from "node:https";
import { pipeline } from "node:stream/promises";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
var TransportError = class extends Error {
  timedOut;
  /** For a timeout: did the server answer at all before it stalled? */
  gotResponse;
  constructor(message, timedOut = false, gotResponse = false) {
    super(message);
    this.name = "TransportError";
    this.timedOut = timedOut;
    this.gotResponse = gotResponse;
  }
};
var MAX_REDIRECTS = 3;
function decoderFor(encoding) {
  switch ((encoding ?? "").toLowerCase()) {
    case "gzip":
      return createGunzip();
    case "deflate":
      return createInflate();
    case "br":
      return createBrotliDecompress();
    default:
      return void 0;
  }
}
async function readBody(res) {
  const chunks = [];
  const sink = async (source) => {
    for await (const chunk of source) chunks.push(chunk);
  };
  const decoder = decoderFor(res.headers["content-encoding"]);
  if (decoder) await pipeline(res, decoder, sink);
  else await pipeline(res, sink);
  return Buffer.concat(chunks).toString("utf8");
}
function flatten(res) {
  const out = {};
  for (const [k, v] of Object.entries(res.headers)) {
    if (v === void 0) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}
var proxyEnv = () => ({
  HTTPS_PROXY: process.env.HTTPS_PROXY,
  https_proxy: process.env.https_proxy,
  NO_PROXY: process.env.NO_PROXY,
  no_proxy: process.env.no_proxy
});
function proxyFor(target, env = proxyEnv()) {
  const raw = env.HTTPS_PROXY ?? env.https_proxy;
  if (!raw) return void 0;
  const host = target.hostname.toLowerCase();
  const bypass = (env.NO_PROXY ?? env.no_proxy ?? "").split(",").map((s) => s.trim().toLowerCase().replace(/^\*?\./, "")).filter(Boolean);
  if (bypass.some((d) => d === "*" || host === d || host.endsWith(`.${d}`))) {
    return void 0;
  }
  return new URL(raw.includes("://") ? raw : `http://${raw}`);
}
function tunnel(proxy, target, timeoutMs) {
  return new Promise((resolve2, reject) => {
    const auth = proxy.username ? {
      "Proxy-Authorization": "Basic " + Buffer.from(
        `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`
      ).toString("base64")
    } : {};
    const authority = `${target.hostname}:${target.port || 443}`;
    const req = httpRequestRaw({
      host: proxy.hostname,
      port: proxy.port || 80,
      method: "CONNECT",
      path: authority,
      headers: { Host: authority, ...auth },
      agent: false
    });
    const timer = setTimeout(
      () => req.destroy(new TransportError("timeout", true)),
      timeoutMs
    );
    req.on("connect", (res, socket) => {
      clearTimeout(timer);
      if (res.statusCode === 200) resolve2(socket);
      else {
        socket.destroy();
        reject(new TransportError(`proxy refused CONNECT: HTTP ${res.statusCode}`));
      }
    });
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err instanceof TransportError ? err : new TransportError(`proxy: ${err.message}`));
    });
    req.end();
  });
}
async function once(url, opts) {
  const target = new URL(url);
  const proxy = proxyFor(target);
  const socket = proxy ? await tunnel(proxy, target, opts.timeoutMs) : void 0;
  return new Promise((resolve2, reject) => {
    let gotResponse = false;
    let timedOut = false;
    const req = httpsRequest(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: opts.method,
        headers: opts.headers,
        // No pool to race at one request per five seconds.
        agent: false,
        // Through a proxy, TLS runs inside the CONNECT tunnel.
        ...socket ? { socket } : {},
        // ☠️ Load-bearing for the rada hosts. See the note at the top.
        ...opts.tlsMaxVersion ? { maxVersion: opts.tlsMaxVersion } : {}
      },
      (res) => {
        gotResponse = true;
        if (res.statusCode === 304) {
          res.resume();
          clearTimeout(timer);
          resolve2({ status: 304, headers: flatten(res), body: "" });
          return;
        }
        readBody(res).then(
          (body) => {
            clearTimeout(timer);
            resolve2({ status: res.statusCode ?? 0, headers: flatten(res), body });
          },
          (err) => {
            clearTimeout(timer);
            reject(
              timedOut ? new TransportError("timeout", true, true) : new TransportError(`response stream: ${err.message}`)
            );
          }
        );
      }
    );
    const timer = setTimeout(() => {
      timedOut = true;
      req.destroy(new TransportError("timeout", true, gotResponse));
    }, opts.timeoutMs);
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(
        timedOut ? new TransportError("timeout", true, gotResponse) : err instanceof TransportError ? err : new TransportError(err.message)
      );
    });
    if (opts.body !== void 0) req.write(opts.body);
    req.end();
  });
}
async function httpRequest(url, opts) {
  let current = url;
  for (let hop = 0; ; hop++) {
    const res = await once(current, opts);
    const redirecting = res.status >= 300 && res.status < 400 && res.headers.location;
    if (opts.noRedirect || !redirecting || opts.method !== "GET") return res;
    if (hop >= MAX_REDIRECTS) {
      throw new TransportError(`more than ${MAX_REDIRECTS} redirects from ${url}`);
    }
    current = new URL(res.headers.location, current).toString();
  }
}

// src/http.ts
var BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
var POLICY = {
  "data.rada": {
    base: "https://data.rada.gov.ua",
    // Documented: <=60 req/min, but the portal asks for a random 5–7 s pause
    // between requests. We honour the request, not just the hard ceiling.
    minIntervalMs: 5e3,
    jitterMs: 2e3,
    ua: "OpenData",
    headers: { Accept: "*/*" },
    tlsMaxVersion: "TLSv1.2"
  },
  "zakon.rada": {
    // Used for ONE thing only: the name→nreg resolver, which answers in a 302
    // Location header. No page body is ever fetched or parsed from this host.
    base: "https://zakon.rada.gov.ua",
    minIntervalMs: 1e3,
    jitterMs: 200,
    ua: BROWSER_UA,
    headers: {
      Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "Accept-Language": "uk-UA,uk;q=0.9"
    },
    tlsMaxVersion: "TLSv1.2"
  },
  lpd: {
    base: "https://lpd-api-prod.court.gov.ua/api/v1",
    minIntervalMs: 700,
    jitterMs: 200,
    ua: "Mozilla/5.0 (compatible; ua-legal-sources/0.1)",
    headers: {
      Accept: "application/json",
      "Accept-Language": "uk-UA,uk;q=0.9",
      Origin: "https://lpd.court.gov.ua",
      Referer: "https://lpd.court.gov.ua/"
    }
  },
  edrsr: {
    base: "https://reyestr.court.gov.ua",
    // >=1.1 s. Measured: a burst produces silent hangs, never a 429.
    minIntervalMs: 1100,
    jitterMs: 150,
    ua: BROWSER_UA,
    headers: {
      Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "Accept-Language": "uk-UA,uk;q=0.9",
      Referer: "https://reyestr.court.gov.ua/"
    }
  }
};
var lastRequestAt = {};
var okCount = {};
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function throttle(host) {
  const p = POLICY[host];
  const gap = p.minIntervalMs + Math.random() * p.jitterMs;
  const since = Date.now() - (lastRequestAt[host] ?? 0);
  if (since < gap) await sleep(gap - since);
}
var SourceError = class extends Error {
  kind;
  /** The HTTP status, when the source answered with one. */
  status;
  constructor(message, kind, status) {
    super(message);
    this.name = "SourceError";
    this.kind = kind;
    this.status = status;
  }
};
var inFlight = {};
function request(host, opts) {
  const run = () => attempt(host, opts);
  const queued = (inFlight[host] ?? Promise.resolve()).then(run, run);
  inFlight[host] = queued.catch(() => {
  });
  return queued;
}
var RETRY_BACKOFF_MS = [2e3, 5e3];
var ATTEMPT_TIMEOUT_MS = 3e4;
async function attempt(host, opts) {
  for (let i = 0; ; i++) {
    try {
      return await requestOnce(host, opts);
    } catch (err) {
      const retryable = err instanceof SourceError && err.kind === "network";
      if (!retryable || i >= RETRY_BACKOFF_MS.length) throw err;
      await sleep(RETRY_BACKOFF_MS[i]);
    }
  }
}
async function requestOnce(host, opts) {
  const p = POLICY[host];
  await throttle(host);
  const headers = { "User-Agent": p.ua, ...p.headers };
  let body;
  const method = opts.method ?? (opts.form || opts.json ? "POST" : "GET");
  if (opts.form) {
    body = new URLSearchParams(opts.form).toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    headers["Origin"] = p.base.replace(/\/api\/v1$/, "");
  }
  if (opts.json !== void 0) {
    body = JSON.stringify(opts.json);
    headers["Content-Type"] = "application/json";
  }
  if (body !== void 0) {
    headers["Content-Length"] = String(Buffer.byteLength(body));
  }
  if (opts.ifModifiedSince) headers["If-Modified-Since"] = opts.ifModifiedSince;
  headers["Accept-Encoding"] = "gzip, deflate";
  const url = p.base + opts.path;
  try {
    const res = await httpRequest(url, {
      method,
      headers,
      body,
      noRedirect: opts.noRedirect,
      timeoutMs: opts.timeoutMs ?? ATTEMPT_TIMEOUT_MS,
      tlsMaxVersion: p.tlsMaxVersion
    });
    lastRequestAt[host] = Date.now();
    okCount[host] = (okCount[host] ?? 0) + 1;
    return {
      status: res.status,
      headers: res.headers,
      body: res.body,
      url,
      notModified: res.status === 304
    };
  } catch (err) {
    lastRequestAt[host] = Date.now();
    if (err instanceof TransportError && err.timedOut) {
      if (err.gotResponse) {
        throw new SourceError(
          `${host}: \u0441\u0430\u0439\u0442 \u043F\u043E\u0447\u0430\u0432 \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u0430\u0442\u0438, \u0430\u043B\u0435 \u043D\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u0432 \u043F\u0435\u0440\u0435\u0434\u0430\u0447\u0443. \u0426\u0435 \u0437\u0431\u0456\u0439 \u0437'\u0454\u0434\u043D\u0430\u043D\u043D\u044F, \u0430 \u041D\u0415 \u0432\u0456\u0434\u0441\u0443\u0442\u043D\u0456\u0441\u0442\u044C \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430.`,
          "network"
        );
      }
      const seen = okCount[host] ?? 0;
      if (seen > 0) {
        throw new SourceError(
          `${host}: \u0442\u0430\u0439\u043C-\u0430\u0443\u0442 \u0431\u0435\u0437 \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u0456 \u043F\u0456\u0441\u043B\u044F ${seen} \u0443\u0441\u043F\u0456\u0448\u043D\u0438\u0445 \u0437\u0430\u043F\u0438\u0442\u0456\u0432. \u0421\u0445\u043E\u0436\u0435 \u043D\u0430 \u043C'\u044F\u043A\u0438\u0439 rate limit \u2014 \u0437\u0430\u0447\u0435\u043A\u0430\u0439 \u043F\u0435\u0440\u0435\u0434 \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u043E\u044E \u0441\u043F\u0440\u043E\u0431\u043E\u044E. \u0426\u0435 \u041D\u0415 \u043E\u0437\u043D\u0430\u0447\u0430\u0454, \u0449\u043E \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430 \u043D\u0435 \u0456\u0441\u043D\u0443\u0454.`,
          "cooldown"
        );
      }
      throw new SourceError(
        `${host}: \u043F\u0435\u0440\u0448\u0438\u0439 \u0437\u0430\u043F\u0438\u0442 \u0431\u0435\u0437 \u0436\u043E\u0434\u043D\u043E\u0457 \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u0456. \u041F\u0440\u0438\u0447\u0438\u043D\u043E\u044E \u043C\u043E\u0436\u0435 \u0431\u0443\u0442\u0438 \u0437\u0431\u0456\u0439 \u0441\u0430\u0439\u0442\u0443 \u0447\u0438 \u043C\u0435\u0440\u0435\u0436\u0456 \u0430\u0431\u043E \u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043A\u0438 \u0437\u0430\u043F\u0438\u0442\u0443. \u0426\u0435 \u041D\u0415 \u043E\u0437\u043D\u0430\u0447\u0430\u0454, \u0449\u043E \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430 \u043D\u0435 \u0456\u0441\u043D\u0443\u0454.`,
        "headers"
      );
    }
    throw new SourceError(
      `${host}: \u043F\u043E\u043C\u0438\u043B\u043A\u0430 \u043C\u0435\u0440\u0435\u0436\u0456: ${err.message}`,
      "network"
    );
  }
}
function encodeNreg(nreg) {
  const segs = nreg.split("/");
  if (segs.some((seg) => seg === "" || seg === "." || seg === "..")) {
    throw new SourceError(`\u041D\u0435\u0434\u043E\u043F\u0443\u0441\u0442\u0438\u043C\u0438\u0439 nreg: \xAB${nreg}\xBB.`, "input");
  }
  return segs.map((seg) => encodeURIComponent(seg)).join("/");
}

// src/cache.ts
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
function cacheRoot(env = {
  UA_LEGAL_CACHE_DIR: process.env.UA_LEGAL_CACHE_DIR,
  CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA
}) {
  const usable = (dir) => dir && isAbsolute(dir) && !dir.includes("${") ? dir : void 0;
  const pluginData = usable(env.CLAUDE_PLUGIN_DATA);
  return usable(env.UA_LEGAL_CACHE_DIR) ?? (pluginData ? join(pluginData, "cache") : join(homedir(), ".cache", "ua-legal-sources"));
}
var ROOT = cacheRoot();
var recent = /* @__PURE__ */ new Map();
var RECENT_MAX = 4;
function remember(key, value) {
  recent.delete(key);
  recent.set(key, value);
  if (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value);
}
function fresh(entry, maxAgeMs) {
  if (maxAgeMs === void 0) return true;
  const age = Date.now() - Date.parse(entry.fetchedAt);
  return Number.isFinite(age) && age <= maxAgeMs;
}
function keyPath(key) {
  const h = createHash("sha256").update(key).digest("hex").slice(0, 32);
  return join(ROOT, `${h}.json`);
}
async function readCache(key, maxAgeMs) {
  const mem2 = recent.get(key);
  if (mem2) return fresh(mem2, maxAgeMs) ? mem2 : void 0;
  try {
    const raw = await readFile(keyPath(key), "utf8");
    const entry = JSON.parse(raw);
    if (typeof entry?.body !== "string" || typeof entry?.fetchedAt !== "string") {
      return void 0;
    }
    if (!fresh(entry, maxAgeMs)) return void 0;
    remember(key, entry);
    return entry;
  } catch {
    return void 0;
  }
}
async function writeCache(key, value) {
  remember(key, value);
  try {
    await mkdir(ROOT, { recursive: true });
    await writeFile(keyPath(key), JSON.stringify(value), "utf8");
  } catch {
  }
}
var mem = /* @__PURE__ */ new Map();
function memGet(key, ttlMs) {
  const hit = mem.get(key);
  if (!hit) return void 0;
  if (Date.now() - hit.at > ttlMs) {
    mem.delete(key);
    return void 0;
  }
  return hit.value;
}
function memSet(key, value) {
  mem.set(key, { at: Date.now(), value });
}

// src/html.ts
var ENTITIES = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&quot;": '"',
  "&apos;": "'",
  "&laquo;": "\xAB",
  "&raquo;": "\xBB",
  "&lt;": "<",
  "&gt;": ">",
  "&mdash;": "\u2014",
  "&ndash;": "\u2013"
};
function decode(s) {
  return s.replace(
    /&(?:nbsp|amp|quot|apos|laquo|raquo|lt|gt|mdash|ndash);/g,
    (m) => ENTITIES[m] ?? m
  ).replace(/&#(\d+);|&#x([0-9a-f]+);/gi, (m, dec, hex) => {
    const code = dec ? Number(dec) : parseInt(hex, 16);
    if (!Number.isInteger(code) || code < 32 || code > 1114111) return m;
    if (code >= 55296 && code <= 57343) return m;
    return String.fromCodePoint(code);
  });
}
function stripTags(html) {
  if (typeof html !== "string") return "";
  return decode(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}
function htmlToText(html) {
  let s = html.replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<br\s*\/?>|<\/(?:p|div|tr|li|h[1-6])>/gi, "\n");
  s = decode(s.replace(/<[^>]+>/g, " "));
  return s.replace(/[ \t]+/g, " ").split("\n").map((line) => line.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// src/rada.ts
var META_TTL = 10 * 60 * 1e3;
var RESOLVE_TTL = 30 * 24 * 60 * 60 * 1e3;
function isoFromInt(n) {
  const s = String(n ?? "");
  if (!/^\d{8}$/.test(s)) return "";
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
var ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
var DASHES = /[\u2010-\u2015\u2212]/g;
function normalizeNreg(raw) {
  const n = raw.replace(ZERO_WIDTH, "").replace(DASHES, "-").trim();
  const bad = n.length === 0 || n.length > 64 || /[\s?#%\\\u0000-\u001f]/.test(n) || n.split("/").some((seg) => seg === "" || seg === "." || seg === "..");
  if (bad) {
    throw new SourceError(
      `\xAB${raw}\xBB \u043D\u0435 \u0441\u0445\u043E\u0436\u0438\u0439 \u043D\u0430 \u0441\u0438\u0441\u0442\u0435\u043C\u043D\u0438\u0439 \u043D\u043E\u043C\u0435\u0440 \u0430\u043A\u0442\u0430 (nreg), \u043D\u0430\u043F\u0440. \xAB435-15\xBB \u0430\u0431\u043E \xAB254\u043A/96-\u0432\u0440\xBB. \u041D\u043E\u043C\u0435\u0440 \u043C\u043E\u0436\u043D\u0430 \u043E\u0442\u0440\u0438\u043C\u0430\u0442\u0438 \u0447\u0435\u0440\u0435\u0437 rada_resolve.`,
      "input"
    );
  }
  return n;
}
function kyivToday(now2 = /* @__PURE__ */ new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now2);
}
function isRealDate(iso) {
  const d = /* @__PURE__ */ new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}
function redactionAsOf(meta, asOf, todayIso) {
  if (asOf > todayIso) return { kind: "future" };
  if (meta.redactions.length === 0) {
    if (meta.adopted && asOf < meta.adopted) {
      return { kind: "before", firstRedaction: meta.adopted };
    }
    return { kind: "no-history" };
  }
  let inForce;
  for (const r of meta.redactions) if (r.date <= asOf) inForce = r;
  if (!inForce) {
    return { kind: "before", firstRedaction: meta.redactions[0].date };
  }
  return { kind: "in-force", redaction: inForce };
}
function parseHistory(history) {
  const out = [];
  for (const chunk of (history || "").split("|")) {
    if (!chunk.trim()) continue;
    const [date, , basis = ""] = chunk.split(":");
    if (!/^\d{8}$/.test(date)) continue;
    const conditional = date.startsWith("3000");
    out.push({
      date: conditional ? "\u043D\u0435\u0432\u0438\u0437\u043D\u0430\u0447\u0435\u043D\u0430" : isoFromInt(date),
      raw: date,
      basis: basis.split(",").map((b) => b.trim()).filter(Boolean),
      conditional
    });
  }
  return out;
}
function splitFuture(reds, todayIso) {
  const past = [];
  const future = [];
  for (const r of reds) {
    if (r.conditional || r.date > todayIso) future.push(r);
    else past.push(r);
  }
  return { past, future };
}
async function getMeta(nreg) {
  nreg = normalizeNreg(nreg);
  const key = `meta:${nreg}`;
  const hit = memGet(key, META_TTL);
  if (hit) return hit;
  const res = await request("data.rada", {
    path: `/laws/show/${encodeNreg(nreg)}.json`
  });
  if (res.status !== 200) {
    throw new SourceError(
      `data.rada: HTTP ${res.status} \u0434\u043B\u044F \u043A\u0430\u0440\u0442\u043A\u0438 ${nreg}. \u041D\u043E\u0440\u043C\u0443 \u041D\u0415 \u043F\u0435\u0440\u0435\u0432\u0456\u0440\u0435\u043D\u043E \u2014 \u043D\u0435 \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u0430\u0439 \u0437 \u043F\u0430\u043C'\u044F\u0442\u0456.`,
      "http"
    );
  }
  let raw;
  try {
    raw = JSON.parse(res.body);
  } catch {
    throw new SourceError(
      `data.rada: \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u044C \u0434\u043B\u044F ${nreg} \u043D\u0435 \u0454 JSON (${res.body.length} \u0431\u0430\u0439\u0442).`,
      "http"
    );
  }
  const todayIso = kyivToday();
  const all = parseHistory(raw.history ?? "");
  const { past, future } = splitFuture(all, todayIso);
  const meta = {
    nreg: raw.nreg ?? nreg,
    nazva: raw.nazva ?? "",
    officialNumber: raw.n_vlas ?? "",
    statusCode: raw.status ?? -1,
    isArchive: raw.is_archive === 1,
    currentRedaction: isoFromInt(raw.datred),
    adopted: isoFromInt(raw.pridat) || void 0,
    basis: (raw.pidstava ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    redactions: past,
    futureRedactions: future,
    totalRedactions: raw.edcnt ?? all.length
  };
  memSet(key, meta);
  return meta;
}
function parseCard(html, nreg) {
  const t = htmlToText(html);
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  const statusIdx = lines.findIndex((l) => /^Стан:/i.test(l));
  const statusText = statusIdx >= 0 ? lines[statusIdx].replace(/^Стан:\s*/i, "").trim() : "";
  const requisites = lines[0] ?? "";
  const issuer = requisites.split(";")[0]?.trim() ?? "";
  const title = statusIdx > 0 ? lines[statusIdx - 1] ?? "" : lines[1] ?? "";
  return { nreg, title, statusText, issuer, requisites };
}
async function getCard(nreg) {
  nreg = normalizeNreg(nreg);
  const key = `card:${nreg}`;
  const hit = memGet(key, META_TTL);
  if (hit) return hit;
  const res = await request("data.rada", {
    path: `/laws/card/${encodeNreg(nreg)}`
  });
  if (res.status !== 200) {
    throw new SourceError(
      `data.rada: HTTP ${res.status} \u0434\u043B\u044F \u043A\u0430\u0440\u0442\u043A\u0438 ${nreg}.`,
      "http"
    );
  }
  const card = parseCard(res.body, nreg);
  memSet(key, card);
  return card;
}
async function getText(nreg, edDate, currentRedaction) {
  nreg = normalizeNreg(nreg);
  const ed = edDate ? edDate.replace(/-/g, "") : "";
  if (ed && !/^\d{8}$/.test(ed)) {
    throw new SourceError(`\u0414\u0430\u0442\u0430 \u0440\u0435\u0434\u0430\u043A\u0446\u0456\u0457 \u043C\u0430\u0454 \u0431\u0443\u0442\u0438 YYYY-MM-DD, \u043E\u0442\u0440\u0438\u043C\u0430\u043D\u043E \xAB${edDate}\xBB.`, "input");
  }
  const path = ed ? `/laws/show/${encodeNreg(nreg)}/ed${ed}.txt` : `/laws/show/${encodeNreg(nreg)}.txt`;
  const cacheKey = `text:${nreg}:${ed || "current"}`;
  const cached = await readCache(cacheKey);
  const result = (body, retrievedAt, fromCache) => ({
    body,
    nreg,
    sourceUrl: `https://data.rada.gov.ua${path}`,
    retrievedAt,
    fromCache
  });
  if (cached && (ed || currentRedaction && cached.redaction === currentRedaction)) {
    return result(cached.body, cached.fetchedAt, true);
  }
  const res = await request("data.rada", {
    path,
    ifModifiedSince: cached?.lastModified
  });
  if (cached && (res.notModified || res.status !== 200)) {
    if (res.notModified && !ed && currentRedaction) {
      await writeCache(cacheKey, { ...cached, redaction: currentRedaction });
    }
    return result(cached.body, cached.fetchedAt, true);
  }
  if (res.status !== 200) {
    throw new SourceError(
      `data.rada: HTTP ${res.status} \u0434\u043B\u044F \u0442\u0435\u043A\u0441\u0442\u0443 ${nreg}` + (ed ? ` (\u0440\u0435\u0434\u0430\u043A\u0446\u0456\u044F ${isoFromInt(ed)})` : "") + `. \u041D\u043E\u0440\u043C\u0443 \u041D\u0415 \u043F\u0435\u0440\u0435\u0432\u0456\u0440\u0435\u043D\u043E.`,
      "http"
    );
  }
  const fetchedAt = (/* @__PURE__ */ new Date()).toISOString();
  await writeCache(cacheKey, {
    body: res.body,
    lastModified: res.headers["last-modified"],
    fetchedAt,
    ...ed ? {} : { redaction: currentRedaction }
  });
  return result(res.body, fetchedAt, false);
}
var ARTICLE = /^Стаття\s+(\d+(?:-\d+)?)\s*\.?/;
var STRUCTURAL = /^(Книга|Розділ|Глава|Підрозділ|Параграф)(?=[\s:.]|$)/iu;
var FINAL_PROVISIONS = /^(?:[IVXІХ]+\.\s*)?(?:(?:ПРИКІНЦЕВІ|ЗАКЛЮЧНІ)(?:\s+ТА\s+ПЕРЕХІДНІ)?|ПЕРЕХІДНІ)\s+ПОЛОЖЕННЯ\s*$/iu;
var FINAL_WORDS = /(прикінцев|перехідн|заключн)/iu;
var POINT = /(?:^|\s|,)(?:п\.|пункт|пп\.)\s*(\d+(?:-\d+)?)(?=$|[\s,])/iu;
var SIGNATURE = /^(Президент України|Голова Верховної Ради України|Прем'єр-міністр України)\s*$/u;
var POINT_LINE = /^(\d+(?:-\d+)?)\.\s/;
var LEVEL = {
  // Final provisions close the whole act, so nothing but another top-level
  // section may end them.
  final: 1,
  \u043A\u043D\u0438\u0433\u0430: 1,
  \u0440\u043E\u0437\u0434\u0456\u043B: 2,
  \u043F\u0456\u0434\u0440\u043E\u0437\u0434\u0456\u043B: 3,
  \u0433\u043B\u0430\u0432\u0430: 4,
  \u043F\u0430\u0440\u0430\u0433\u0440\u0430\u0444: 5
};
var ARTICLE_LEVEL = 6;
function plainDashes(s) {
  return s.replace(ZERO_WIDTH, "").replace(DASHES, "-");
}
function levelOf(line) {
  const l = plainDashes(line);
  if (ARTICLE.test(l)) return ARTICLE_LEVEL;
  const m = STRUCTURAL.exec(l);
  if (m) return LEVEL[m[1].toLowerCase()];
  return FINAL_PROVISIONS.test(l.trim()) ? LEVEL.final : void 0;
}
var MAX_UNIT_CHARS = 2e4;
var MAX_MARKERS = 40;
var APOSTROPHES = new RegExp(
  `[${[8217, 700, 8216, 96, 8242].map((c) => String.fromCharCode(c)).join("")}]`,
  "g"
);
var BOOK_ORDINALS = [
  "\u043F\u0435\u0440\u0448\u0430",
  "\u0434\u0440\u0443\u0433\u0430",
  "\u0442\u0440\u0435\u0442\u044F",
  "\u0447\u0435\u0442\u0432\u0435\u0440\u0442\u0430",
  "\u043F'\u044F\u0442\u0430",
  "\u0448\u043E\u0441\u0442\u0430",
  "\u0441\u044C\u043E\u043C\u0430",
  "\u0432\u043E\u0441\u044C\u043C\u0430",
  "\u0434\u0435\u0432'\u044F\u0442\u0430",
  "\u0434\u0435\u0441\u044F\u0442\u0430"
];
function toRoman(n) {
  const table = [
    [1e3, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"]
  ];
  let out = "";
  for (const [value, numeral] of table) {
    while (n >= value) {
      out += numeral;
      n -= value;
    }
  }
  return out;
}
var CYR_I = String.fromCharCode(1110);
var CYR_X = String.fromCharCode(1093);
var ROMAN_TOKEN = new RegExp(`(^|\\s)([ivxlcdm${CYR_I}${CYR_X}]+)(?=$|[\\s.:,])`, "gu");
function normHeading(s) {
  return plainDashes(s).replace(APOSTROPHES, "'").toLowerCase().replace(/\s+/g, " ").trim().replace(
    ROMAN_TOKEN,
    (_, space, numeral) => space + numeral.replaceAll(CYR_I, "i").replaceAll(CYR_X, "x")
  );
}
function headingVariants(spec) {
  const m = /^(книга|розділ)\s+(\d{1,2})$/.exec(spec);
  if (!m) return [];
  const n = Number(m[2]);
  if (m[1] === "\u043A\u043D\u0438\u0433\u0430") return BOOK_ORDINALS[n - 1] ? [`\u043A\u043D\u0438\u0433\u0430 ${BOOK_ORDINALS[n - 1]}`] : [];
  return n > 0 ? [`\u0440\u043E\u0437\u0434\u0456\u043B ${toRoman(n)}`] : [];
}
function buildIndex(text2, refDate = kyivToday()) {
  const lines = text2.replace(/\r\n?/g, "\n").split("\n");
  const articles = /* @__PURE__ */ new Map();
  const structural = [];
  const excluded = /* @__PURE__ */ new Map();
  lines.forEach((raw, i) => {
    const l = plainDashes(raw);
    const excl = EXCLUDED.exec(l);
    if (excl) excluded.set(normNum(excl[1]), excl[0]);
    const a = ARTICLE.exec(l);
    if (a) {
      const num = a[1];
      const hits = articles.get(num);
      if (hits) hits.push(i);
      else articles.set(num, [i]);
      return;
    }
    if (STRUCTURAL.test(l) || FINAL_PROVISIONS.test(l.trim())) {
      structural.push({ label: raw.trim(), line: i });
    }
  });
  return { articles, structural, excluded, lines, refDate };
}
function splitMarkers(text2) {
  const markers = [];
  let clean = "";
  let depth = 0;
  let current = "";
  for (const ch of text2) {
    if (ch === "{") {
      depth++;
      current += ch;
      continue;
    }
    if (ch === "}") {
      depth = Math.max(0, depth - 1);
      current += ch;
      if (depth === 0) {
        markers.push(current.trim());
        current = "";
      }
      continue;
    }
    if (depth > 0) current += ch;
    else clean += ch;
  }
  if (current.trim()) markers.push(current.trim());
  return {
    clean: clean.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(),
    markers
  };
}
var EXCLUDED = /\{\s*[СC]тат(?:тю|ті)\s+([^\s}]+?)\.?\s+виключено[^}]*?\}/i;
var EXCL_BASIS = /(Закон[^}]*?№\s*[^\s}]+(?:\s+від\s+[\d.]+)?)/i;
function normNum(n) {
  return n.replace(/[.\s]/g, "").replace(/[-‑]/g, "");
}
function sliceUnit(index, unit) {
  const spec = plainDashes(unit).trim();
  const part = partAddress(spec);
  if (part) return slicePart(index, part);
  const point = POINT.exec(spec);
  if (point) return slicePoint(index, spec, point);
  const artMatch = /^(?:ст\.?|стаття|st)?\s*(\d+(?:-\d+)?)$/i.exec(spec);
  let starts = [];
  let label = spec;
  if (artMatch) {
    const num = artMatch[1];
    label = `\u0421\u0442\u0430\u0442\u0442\u044F ${num}`;
    starts = index.articles.get(num) ?? [];
    let flattened = false;
    if (starts.length === 0 && num.includes("-")) {
      starts = index.articles.get(num.replace(/-/g, "")) ?? [];
      flattened = starts.length > 0;
    }
    if (starts.length > 0) {
      return {
        found: true,
        unit: label,
        occurrences: starts.map((s) => extractAt(index, s, num, starts.length)),
        ambiguous: starts.length > 1 || flattened,
        ambiguityReason: starts.length > 1 ? "collision" : flattened ? "flattened" : void 0
      };
    }
    const marker = index.excluded.get(normNum(num));
    if (marker) {
      return {
        found: true,
        unit: label,
        ambiguous: false,
        occurrences: [
          {
            heading: label,
            text: "",
            markers: [marker],
            excluded: { marker, basis: basisOf(marker) },
            charCount: 0,
            context: ""
          }
        ]
      };
    }
    return { found: false, unit: spec, occurrences: [], ambiguous: false };
  }
  const pool = findHeadings(index, spec);
  starts = pool.map((s) => s.line);
  if (pool[0]) label = pool[0].label;
  if (starts.length === 0) {
    return { found: false, unit: spec, occurrences: [], ambiguous: false };
  }
  return {
    found: true,
    unit: label,
    occurrences: starts.map((s) => extractAt(index, s, void 0, starts.length)),
    ambiguous: starts.length > 1,
    ambiguityReason: starts.length > 1 ? "repeated" : void 0
  };
}
function partAddress(spec) {
  const s = spec.toLowerCase().replace(/\s+/g, " ").trim();
  const art = /(?:^|[\s,])(?:ст\.?|статт[яі])\s*(\d+(?:-\d+)?)(?=$|[\s,])/u.exec(s);
  const prt = /(?:^|[\s,])(?:ч\.?|частин[аи])\s*(\d+(?:-\d+)?)(?=$|[\s,])/u.exec(s);
  if (!art || !prt) return void 0;
  const pnt = /(?:^|[\s,])(?:п\.?|пункт)\s*(\d+(?:-\d+)?)(?=$|[\s,])/u.exec(s);
  const rest = [art, prt, pnt].reduce((acc, m) => m ? acc.replace(m[0], " ") : acc, s);
  if (rest.replace(/[\s,]/g, "")) return void 0;
  return { article: art[1], part: prt[1], point: pnt?.[1] };
}
function slicePart(index, addr) {
  const whole = sliceUnit(index, addr.article);
  if (!whole.found) return whole;
  const label = `${addr.point ? `\u043F. ${addr.point} ` : ""}\u0447. ${addr.part} \u0441\u0442. ${addr.article}`;
  const narrow = (text2, startRe, nextRe) => {
    const lines = text2.split("\n");
    const from = lines.findIndex((l) => startRe.test(l));
    if (from < 0) return void 0;
    let to = lines.length;
    for (let k = from + 1; k < lines.length; k++) {
      if (nextRe.test(lines[k])) {
        to = k;
        break;
      }
    }
    return lines.slice(from, to).join("\n").trim();
  };
  const esc = (n) => n.replace(/-/g, "-?");
  return {
    ...whole,
    unit: label,
    occurrences: whole.occurrences.map((o) => {
      const partText = narrow(o.text, new RegExp(`^${esc(addr.part)}\\.\\s`), /^\d+(?:-\d+)?\.\s/);
      const pointText = partText && addr.point ? narrow(partText, new RegExp(`^${esc(addr.point)}\\)\\s`), /^\d+(?:-\d+)?\)\s/) : void 0;
      const narrowed = pointText ?? partText;
      if (!narrowed || addr.point && !pointText) {
        return { ...o, partNote: `${label}: \u0442\u0430\u043A\u043E\u0457 \u0447\u0430\u0441\u0442\u0438\u043D\u0438 \u0447\u0438 \u043F\u0443\u043D\u043A\u0442\u0443 \u0432 \u0442\u0435\u043A\u0441\u0442\u0456 \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E \u2014 \u043F\u043E\u043A\u0430\u0437\u0430\u043D\u043E \u0432\u0441\u044E \u0441\u0442\u0430\u0442\u0442\u044E.` };
      }
      return { ...o, text: `${o.heading}
${narrowed}`, partNote: `\u041F\u043E\u043A\u0430\u0437\u0430\u043D\u043E \u043B\u0438\u0448\u0435 ${label}; \u043F\u043E\u0432\u043D\u0438\u0439 \u0442\u0435\u043A\u0441\u0442 \u2014 unit \xAB${addr.article}\xBB.` };
    })
  };
}
function findHeadings(index, spec) {
  const needle = normHeading(spec);
  const byHeading = (wanted) => index.structural.filter((s) => wanted.includes(normHeading(s.label)));
  let pool = byHeading([needle]);
  if (pool.length === 0) pool = byHeading(headingVariants(needle));
  if (pool.length === 0) {
    pool = index.structural.filter((s) => {
      const label = normHeading(s.label);
      return label.startsWith(needle) && !/[\p{L}\p{N}]/u.test(label.charAt(needle.length));
    });
  }
  if (pool.length === 0 && FINAL_WORDS.test(needle)) {
    pool = index.structural.filter((s) => FINAL_PROVISIONS.test(plainDashes(s.label)));
  }
  return pool;
}
function unitEnd(index, start) {
  const own = levelOf(index.lines[start]) ?? ARTICLE_LEVEL;
  for (let j = start + 1; j < index.lines.length; j++) {
    if (SIGNATURE.test(plainDashes(index.lines[j]).trim())) return j;
    const lvl = levelOf(index.lines[j]);
    if (lvl !== void 0 && lvl <= own) return j;
  }
  return index.lines.length;
}
function slicePoint(index, spec, point) {
  const num = point[1];
  const label = `\u043F. ${num}`;
  const parentSpec = spec.replace(point[0], " ").replace(/розділу/iu, " ").replace(/\s+/g, " ").trim();
  let from = 0;
  let to = index.lines.length;
  let parent = "";
  if (parentSpec) {
    const pool = findHeadings(index, parentSpec);
    if (pool.length === 0) return { found: false, unit: spec, occurrences: [], ambiguous: false };
    if (pool.length > 1) {
      return {
        found: true,
        unit: spec,
        ambiguous: true,
        ambiguityReason: "repeated",
        occurrences: pool.map((h) => ({
          heading: h.label,
          text: "",
          markers: [],
          charCount: 0,
          context: ""
        }))
      };
    }
    from = pool[0].line + 1;
    to = unitEnd(index, pool[0].line);
    parent = pool[0].label;
  } else if (index.articles.size > 0) {
    return { found: false, unit: spec, occurrences: [], ambiguous: false };
  }
  const wanted = [num, num.replace(/-/g, "")];
  const starts = [];
  for (let j = from; j < to; j++) {
    const m = POINT_LINE.exec(plainDashes(index.lines[j]));
    if (m && wanted.includes(m[1])) starts.push({ line: j, printed: m[1] });
  }
  if (starts.length > 0) {
    const heading = parent ? `${parent}, ${label}` : label;
    const occurrences = starts.map(({ line }) => {
      let end = to;
      for (let k = line + 1; k < to; k++) {
        const l = plainDashes(index.lines[k]);
        if (POINT_LINE.test(l) || levelOf(l) !== void 0 || SIGNATURE.test(l.trim())) {
          end = k;
          break;
        }
      }
      const { raw: _raw, ...occ } = sliceRange(index, line, end, starts.length);
      return { ...occ, heading, context: parent };
    });
    const flattened = starts.some((s) => s.printed !== num);
    return {
      found: true,
      unit: heading,
      occurrences,
      ambiguous: starts.length > 1 || flattened,
      ambiguityReason: starts.length > 1 ? "collision" : flattened ? "flattened" : void 0
    };
  }
  const scope = index.lines.slice(from, to).join("\n");
  const repealed = new RegExp(
    `\\{\\s*\u041F\u0443\u043D\u043A\u0442\\s+${num.replace(/-/g, "-?")}\\s[^}]*?\u0432\u0438\u043A\u043B\u044E\u0447\u0435\u043D\u043E[^}]*\\}`,
    "iu"
  ).exec(scope);
  if (repealed) {
    return {
      found: true,
      unit: parent ? `${parent}, ${label}` : label,
      ambiguous: false,
      occurrences: [
        {
          heading: parent ? `${parent}, ${label}` : label,
          text: "",
          markers: [repealed[0]],
          excluded: { marker: repealed[0], basis: basisOf(repealed[0]) },
          charCount: 0,
          context: parent
        }
      ]
    };
  }
  return { found: false, unit: spec, occurrences: [], ambiguous: false };
}
function basisOf(marker) {
  const m = EXCL_BASIS.exec(marker);
  return m ? m[1].trim() : "\u0440\u0435\u043A\u0432\u0456\u0437\u0438\u0442\u0438 \u043D\u0435 \u0440\u043E\u0437\u043F\u0456\u0437\u043D\u0430\u043D\u043E";
}
function extractAt(index, start, articleNum, sharing = 1) {
  const occ = sliceRange(index, start, unitEnd(index, start), sharing);
  const exclMatch = EXCLUDED.exec(occ.raw);
  if (exclMatch && articleNum !== void 0 && normNum(exclMatch[1]) === normNum(articleNum)) {
    occ.excluded = { marker: exclMatch[0], basis: basisOf(exclMatch[0]) };
  }
  const { raw: _raw, ...rest } = occ;
  return rest;
}
var STRUCK = /\/\*([\s\S]*?)\*\//g;
var KSU_DATE = /Конституційного\s+Суду[^{}]*?від\s+(\d{2})\.(\d{2})\.(\d{4})/u;
var DELAYED = /[ув]трачає\s+чинність\s+через\s+(\S+)\s+місяц/u;
var AT_ONCE = /[ув]трачає\s+чинність\s+(?:з|із|зі)\s+дня\s+ухвалення/u;
var PARTIAL = /в\s+тім,\s+що|а\s+саме|^\{\s*Положення\s/u;
var MONTH_WORDS = {
  "\u043E\u0434\u0438\u043D": 1,
  "\u043E\u0434\u043D\u043E\u0433\u043E": 1,
  "\u0434\u0432\u0430": 2,
  "\u0434\u0432\u043E\u0445": 2,
  "\u0442\u0440\u0438": 3,
  "\u0442\u0440\u044C\u043E\u0445": 3,
  "\u0447\u043E\u0442\u0438\u0440\u0438": 4,
  "\u0447\u043E\u0442\u0438\u0440\u044C\u043E\u0445": 4,
  "\u043F'\u044F\u0442\u044C": 5,
  "\u043F'\u044F\u0442\u0438": 5,
  "\u0448\u0456\u0441\u0442\u044C": 6,
  "\u0448\u0435\u0441\u0442\u0438": 6,
  "\u0434\u0435\u0432'\u044F\u0442\u044C": 9,
  "\u0434\u0435\u0432'\u044F\u0442\u0438": 9,
  "\u0434\u0432\u0430\u043D\u0430\u0434\u0446\u044F\u0442\u044C": 12,
  "\u0434\u0432\u0430\u043D\u0430\u0434\u0446\u044F\u0442\u0438": 12
};
function addMonths(iso, months) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}
function strikeDown(raw, refDate) {
  const items2 = [];
  const text2 = raw.replace(STRUCK, (_, inner) => {
    const marker = (/\{[^{}]*\}/.exec(inner)?.[0] ?? "").replace(APOSTROPHES, "'");
    const words = inner.replace(/\{[^{}]*\}/g, " ").replace(/\s+/g, " ").trim();
    const decided = KSU_DATE.exec(marker);
    const decidedOn = decided ? `${decided[3]}-${decided[2]}-${decided[1]}` : null;
    const delay = DELAYED.exec(marker);
    const months = delay ? MONTH_WORDS[delay[1]] ?? (Number(delay[1]) || void 0) : void 0;
    const lostForceOn = !decidedOn ? null : months ? addMonths(decidedOn, months) : AT_ONCE.test(marker) ? decidedOn : null;
    const partial = PARTIAL.test(marker);
    const inForce = lostForceOn ? refDate < lostForceOn : null;
    items2.push({ text: words.slice(0, 300), marker, lostForceOn, partial, inForce });
    if (inForce === false && !partial) {
      const lead = /^\d+(?:-\d+)?\.\s/.exec(words)?.[0] ?? "";
      const [y, m, d] = lostForceOn.split("-");
      return `${lead}[\u0432\u0438\u0437\u043D\u0430\u043D\u043E \u043D\u0435\u043A\u043E\u043D\u0441\u0442\u0438\u0442\u0443\u0446\u0456\u0439\u043D\u0438\u043C, \u043D\u0435 \u0434\u0456\u0454 \u0437 ${d}.${m}.${y} \u2014 \u0434\u0438\u0432. unconstitutional]`;
    }
    return inner;
  });
  return { text: text2, items: items2 };
}
function sliceRange(index, start, end, sharing = 1) {
  const { lines } = index;
  const rawText = lines.slice(start, end).join("\n").trim();
  const struck = strikeDown(rawText, index.refDate);
  const split = splitMarkers(struck.text);
  const budget = Math.floor(MAX_UNIT_CHARS / sharing);
  const truncated = split.clean.length > budget;
  const clean = truncated ? split.clean.slice(0, budget) : split.clean;
  const markers = split.markers.slice(0, Math.max(5, Math.floor(MAX_MARKERS / sharing)));
  let context = "";
  for (let j = index.structural.length - 1; j >= 0; j--) {
    if (index.structural[j].line < start) {
      context = index.structural[j].label;
      break;
    }
  }
  return {
    heading: lines[start].trim(),
    text: clean,
    markers,
    charCount: rawText.length,
    context,
    raw: rawText,
    ...truncated ? { truncated } : {},
    ...struck.items.length ? { unconstitutional: struck.items } : {}
  };
}
function listUnits(index, filter) {
  const f = filter?.trim().toLowerCase();
  const keep = (label) => !f || label.toLowerCase().includes(f);
  const out = index.structural.map((s) => s.label).filter(keep);
  for (const s of index.structural) {
    if (!FINAL_PROVISIONS.test(plainDashes(s.label))) continue;
    const end = unitEnd(index, s.line);
    for (let j = s.line + 1; j < end; j++) {
      const l = plainDashes(index.lines[j]).trim();
      const point = POINT_LINE.exec(l);
      const gone = /^\{\s*Пункт\s+(\d+(?:-\d+)?)\s[^}]*виключено/iu.exec(l);
      const label = point ? `${s.label}, \u043F. ${point[1]}: ${l.slice(point[0].length, point[0].length + 110)}\u2026` : gone ? `${s.label}, \u043F. ${gone[1]}: \u0412\u0418\u041A\u041B\u042E\u0427\u0415\u041D\u041E` : void 0;
      if (label && keep(label)) out.push(label);
    }
  }
  for (const lines of index.articles.values()) {
    for (const line of lines) {
      const label = index.lines[line].trim();
      if (keep(label)) out.push(label);
    }
  }
  return out;
}
function parseNregList(body) {
  try {
    const v = JSON.parse(body);
    return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string") ? v : void 0;
  } catch {
    return void 0;
  }
}
async function resolveNreg(name) {
  const cacheKey = `resolve:${name.toLowerCase()}`;
  const hit = memGet(cacheKey, RESOLVE_TTL);
  if (hit) return hit;
  const disk = await readCache(cacheKey, RESOLVE_TTL);
  const cached = disk && parseNregList(disk.body);
  if (cached) {
    memSet(cacheKey, cached);
    return cached;
  }
  const res = await request("zakon.rada", {
    path: `/laws/find/a?text=${encodeURIComponent(name)}`,
    noRedirect: true
  });
  const loc = res.headers["location"] ?? "";
  if (res.status < 300 || res.status >= 400 || !loc) {
    return [];
  }
  const m = /^\/laws\/(?:main|show)\/(.+)$/.exec(loc);
  if (!m) return [];
  const nregs = m[1].split(",").map((x) => decodeURIComponent(x.trim()));
  memSet(cacheKey, nregs);
  await writeCache(cacheKey, {
    body: JSON.stringify(nregs),
    fetchedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  return nregs;
}
async function resolve(name, maxCandidates = 4) {
  const nregs = await resolveNreg(name);
  if (nregs.length === 0) {
    return {
      query: name,
      chosen: null,
      candidates: [],
      ambiguous: true,
      note: `\u0420\u0435\u0454\u0441\u0442\u0440 \u043D\u0435 \u0434\u0430\u0432 \u043E\u0434\u043D\u043E\u0437\u043D\u0430\u0447\u043D\u043E\u0457 \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u0456 \u043D\u0430 \xAB${name}\xBB. \u0421\u043F\u0438\u0441\u043E\u043A, \u044F\u043A\u0438\u0439 \u0432\u0456\u043D \u043F\u043E\u0432\u0435\u0440\u0442\u0430\u0454 \u0437\u0430\u043C\u0456\u0441\u0442\u044C \u043D\u0435\u0457, \u0432\u0456\u0434\u0441\u043E\u0440\u0442\u043E\u0432\u0430\u043D\u0438\u0439 \u0417\u0410 \u0414\u0410\u0422\u041E\u042E, \u0430 \u043D\u0435 \u0437\u0430 \u0440\u0435\u043B\u0435\u0432\u0430\u043D\u0442\u043D\u0456\u0441\u0442\u044E, \u0442\u043E\u043C\u0443 \u043F\u043E\u0442\u0440\u0456\u0431\u043D\u043E\u0433\u043E \u0430\u043A\u0442\u0430 \u0432 \u043D\u044C\u043E\u043C\u0443 \u043C\u043E\u0436\u0435 \u043D\u0435 \u0431\u0443\u0442\u0438 \u0432\u0437\u0430\u0433\u0430\u043B\u0456. \u0421\u043F\u0440\u043E\u0431\u0443\u0439 \u043F\u043E\u0447\u0430\u0442\u043E\u043A \u043E\u0444\u0456\u0446\u0456\u0439\u043D\u043E\u0457 \u043D\u0430\u0437\u0432\u0438 (\xAB\u041F\u0440\u043E \u2026\xBB) \u0430\u0431\u043E \u043D\u043E\u043C\u0435\u0440 \u0430\u043A\u0442\u0430 (\xAB3543-XII\xBB).`
    };
  }
  const metas = [];
  for (const nreg of nregs.slice(0, maxCandidates)) {
    metas.push(await getMeta(nreg).then((meta) => ({ nreg, meta }), () => ({ nreg, meta: void 0 })));
  }
  const cards = /* @__PURE__ */ new Map();
  const byNewest = metas.filter((m) => m.meta && !m.meta.isArchive).sort((a, b) => b.meta.currentRedaction.localeCompare(a.meta.currentRedaction));
  for (const { nreg } of byNewest) {
    const card = await getCard(nreg).catch(() => void 0);
    cards.set(nreg, card);
    if (card && !/втратив\s+чинн/i.test(card.statusText)) break;
  }
  const candidates = metas.map(({ nreg, meta }) => {
    const card = cards.get(nreg);
    if (!meta || cards.has(nreg) && !card) {
      return {
        nreg,
        title: meta?.nazva ?? "",
        statusText: "\u0440\u0435\u043A\u0432\u0456\u0437\u0438\u0442\u0438 \u043D\u0435 \u043E\u0442\u0440\u0438\u043C\u0430\u043D\u043E",
        isArchive: meta ? meta.isArchive : null,
        currentRedaction: meta?.currentRedaction ?? "",
        officialNumber: meta?.officialNumber ?? "",
        verified: false
      };
    }
    return {
      nreg: meta.nreg,
      title: card?.title || meta.nazva,
      statusText: card?.statusText || (meta.isArchive ? "\u0430\u0440\u0445\u0456\u0432\u043D\u0430 \u0440\u0435\u0434\u0430\u043A\u0446\u0456\u044F" : "\u043D\u0435 \u043F\u0435\u0440\u0435\u0432\u0456\u0440\u044F\u043B\u043E\u0441\u044C: \u0454 \u043D\u043E\u0432\u0456\u0448\u0430 \u0447\u0438\u043D\u043D\u0430 \u0440\u0435\u0434\u0430\u043A\u0446\u0456\u044F"),
      isArchive: meta.isArchive,
      currentRedaction: meta.currentRedaction,
      officialNumber: meta.officialNumber,
      verified: true
    };
  });
  const { chosen, note } = selectAct(candidates);
  return { query: name, chosen, candidates, ambiguous: false, note };
}
function selectAct(candidates) {
  const live = candidates.filter(
    (c) => c.verified && c.isArchive === false && !/втратив\s+чинн/i.test(c.statusText)
  );
  const chosen = live.length > 0 ? [...live].sort(
    (a, b) => b.currentRedaction.localeCompare(a.currentRedaction)
  )[0] : null;
  const archived = candidates.filter((c) => c.isArchive === true).length;
  const repealed = candidates.filter(
    (c) => c.verified && /втратив\s+чинн/i.test(c.statusText)
  ).length;
  const unverified = candidates.filter((c) => !c.verified).length;
  const notes = [];
  if (archived > 0) {
    notes.push(
      `\u0412\u0456\u0434\u043A\u0438\u043D\u0443\u0442\u043E ${archived} \u0430\u0440\u0445\u0456\u0432\u043D${archived === 1 ? "\u0438\u0439 \u0430\u043A\u0442" : "\u0456 \u0430\u043A\u0442\u0438"}. \u0410\u0440\u0445\u0456\u0432\u043D\u0456 \xAB\u0434\u0432\u0456\u0439\u043D\u0438\u043A\u0438\xBB \u043A\u043E\u0434\u0435\u043A\u0441\u0456\u0432 \u043C\u0430\u044E\u0442\u044C \u0441\u0442\u0430\u043D \xAB\u0427\u0438\u043D\u043D\u0438\u0439\xBB, \u0430\u043B\u0435 \u043C\u0456\u0441\u0442\u044F\u0442\u044C \u0437\u0430\u0441\u0442\u0430\u0440\u0456\u043B\u0456 \u043D\u043E\u0440\u043C\u0438 \u2014 \u0457\u0445 \u0432\u0438\u0437\u043D\u0430\u0447\u0435\u043D\u043E \u0437\u0430 \u043F\u0440\u0430\u043F\u043E\u0440\u0446\u0435\u043C is_archive, \u0430 \u043D\u0435 \u0437\u0430 \u043D\u0430\u0437\u0432\u043E\u044E.`
    );
  }
  if (repealed > 0) {
    notes.push(`\u0412\u0456\u0434\u043A\u0438\u043D\u0443\u0442\u043E ${repealed} \u0430\u043A\u0442(\u0438), \u0449\u043E \u0432\u0442\u0440\u0430\u0442\u0438\u043B\u0438 \u0447\u0438\u043D\u043D\u0456\u0441\u0442\u044C.`);
  }
  if (unverified > 0) {
    notes.push(
      `\u2620\uFE0F ${unverified} \u043A\u0430\u043D\u0434\u0438\u0434\u0430\u0442${unverified === 1 ? "\u0430" : "\u0456\u0432"} \u043D\u0435 \u043F\u0435\u0440\u0435\u0432\u0456\u0440\u0435\u043D\u043E (\u0434\u0436\u0435\u0440\u0435\u043B\u043E \u043D\u0435 \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u043B\u043E). ${unverified === 1 ? "\u0419\u043E\u0433\u043E" : "\u0407\u0445"} \u041D\u0415 \u043E\u0431\u0440\u0430\u043D\u043E \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u043D\u043E: \u043D\u0435\u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043D\u0438\u0439 \u0430\u043A\u0442 \u043C\u043E\u0436\u0435 \u0431\u0443\u0442\u0438 \u0430\u0440\u0445\u0456\u0432\u043D\u0438\u043C, \u0430 \u0430\u0440\u0445\u0456\u0432\u043D\u0438\u0439 \u0434\u0430\u0454 \u0437\u0430\u0441\u0442\u0430\u0440\u0456\u043B\u0443 \u043D\u043E\u0440\u043C\u0443. \u041F\u0435\u0440\u0435\u0432\u0456\u0440 \u0432\u0440\u0443\u0447\u043D\u0443 \u0447\u0435\u0440\u0435\u0437 rada_status.`
    );
  }
  if (!chosen) {
    notes.push(
      "\u0416\u043E\u0434\u043D\u043E\u0433\u043E \u041F\u0406\u0414\u0422\u0412\u0415\u0420\u0414\u0416\u0415\u041D\u041E \u0447\u0438\u043D\u043D\u043E\u0433\u043E \u0430\u043A\u0442\u0430 \u043D\u0435 \u043E\u0431\u0440\u0430\u043D\u043E. \u041D\u0435 \u0446\u0438\u0442\u0443\u0439 \u043D\u043E\u0440\u043C\u0443, \u043F\u043E\u043A\u0438 \u0430\u043A\u0442 \u043D\u0435 \u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043D\u043E."
    );
  }
  return { chosen, note: notes.join(" ") };
}
var RADA_STATUS_NOTE = "\u0421\u0442\u0430\u043D \u0410\u041A\u0422\u0410 \u2260 \u0441\u0442\u0430\u043D \u0441\u0442\u0430\u0442\u0442\u0456: \u0443 \u0447\u0438\u043D\u043D\u043E\u043C\u0443 \u0430\u043A\u0442\u0456 \u0431\u0443\u0432\u0430\u044E\u0442\u044C \u0432\u0438\u043A\u043B\u044E\u0447\u0435\u043D\u0456 \u0441\u0442\u0430\u0442\u0442\u0456. \u041F\u0435\u0440\u0435\u0432\u0456\u0440\u044F\u0439 \u043A\u043E\u043D\u043A\u0440\u0435\u0442\u043D\u0443 \u043E\u0434\u0438\u043D\u0438\u0446\u044E \u0447\u0435\u0440\u0435\u0437 rada_unit.";

// src/lpd.ts
var SITE = "https://lpd.court.gov.ua";
function items(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    for (const k of ["results", "data", "items", "rows", "legalPositions"]) {
      const v = payload[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}
async function call(path, body) {
  const res = await request("lpd", { path, json: body });
  if (res.status !== 200) {
    throw new SourceError(
      `\u041B\u041F\u0414: HTTP ${res.status} \u043D\u0430 ${path}. \u041F\u0440\u0430\u043A\u0442\u0438\u043A\u0443 \u041D\u0415 \u043F\u0435\u0440\u0435\u0432\u0456\u0440\u0435\u043D\u043E \u2014 \u043D\u0435 \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u0430\u0439 \u0437 \u043F\u0430\u043C'\u044F\u0442\u0456.`,
      "http",
      res.status
    );
  }
  try {
    return JSON.parse(res.body);
  } catch {
    throw new SourceError(`\u041B\u041F\u0414: \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u044C \u043D\u0430 ${path} \u043D\u0435 \u0454 JSON.`, "http");
  }
}
var SNIPPET_CHARS = 600;
function queryStems(query) {
  return (query.toLowerCase().match(/[\p{L}]{3,}/gu) ?? []).map((w) => w.slice(0, 5));
}
function mentionsQuery(text2, stems) {
  const t = text2.toLowerCase();
  return stems.some((stem) => t.includes(stem));
}
async function searchPositions(query, semantic = false) {
  let payload;
  let fallbackNote = "";
  try {
    payload = await call("/search/text", { query, aiEnabled: semantic, comment: null });
  } catch (err) {
    const serverError = err instanceof SourceError && (err.status ?? 0) >= 500;
    if (!semantic || !serverError) throw err;
    payload = await call("/search/text", { query, aiEnabled: false, comment: null });
    semantic = false;
    fallbackNote = `\u0421\u0435\u043C\u0430\u043D\u0442\u0438\u0447\u043D\u0438\u0439 \u043F\u043E\u0448\u0443\u043A \u041B\u041F\u0414 \u043D\u0435 \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0432 (HTTP ${err.status}), \u0442\u043E\u043C\u0443 \u043F\u043E\u043A\u0430\u0437\u0430\u043D\u043E \u0437\u0432\u0438\u0447\u0430\u0439\u043D\u0438\u0439 \u043F\u043E\u0448\u0443\u043A \u0442\u0438\u0445 \u0441\u0430\u043C\u0438\u0445 \u0441\u043B\u0456\u0432. `;
  }
  const raw = items(payload);
  const stems = semantic ? [] : queryStems(query);
  const positions = raw.filter((it) => it && typeof it === "object").map((it) => {
    const id = String(it.id ?? it.legalPositionId ?? "?");
    const extra = {};
    for (const k of ["approvedAt", "courtName", "documentDate", "status"]) {
      if (it[k] !== void 0 && it[k] !== null) extra[k] = String(it[k]);
    }
    const title = stripTags(it.title ?? it.name);
    const full = stripTags(it.text ?? it.shortText);
    const truncated = full.length > SNIPPET_CHARS;
    return {
      id,
      ...stems.length ? { queryTermsFound: mentionsQuery(`${title} ${full}`, stems) } : {},
      title,
      text: truncated ? `${full.slice(0, SNIPPET_CHARS)}\u2026` : full,
      ...truncated ? { truncated } : {},
      url: `${SITE}/legal-position/${id}`,
      extra
    };
  });
  if (stems.length && positions.length && positions.every((p) => !p.queryTermsFound)) {
    return {
      positions: [],
      semantic,
      note: fallbackNote + "\u0416\u043E\u0434\u043D\u0430 \u0437 \u043F\u043E\u0437\u0438\u0446\u0456\u0439, \u044F\u043A\u0456 \u043F\u043E\u0432\u0435\u0440\u043D\u0443\u043B\u0430 \u041B\u041F\u0414, \u043D\u0435 \u043C\u0456\u0441\u0442\u0438\u0442\u044C \u0441\u043B\u0456\u0432 \u0437\u0430\u043F\u0438\u0442\u0443 \u2014 \u0446\u0435 \u043D\u0435 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u0438 \u043F\u043E\u0448\u0443\u043A\u0443, \u0430 \u0434\u043E\u0431\u0456\u0440\u043A\u0430, \u044F\u043A\u0443 \u0431\u0430\u0437\u0430 \u0432\u0456\u0434\u0434\u0430\u0454, \u043A\u043E\u043B\u0438 \u043D\u0456\u0447\u043E\u0433\u043E \u043D\u0435 \u0437\u043D\u0430\u0439\u0448\u043B\u0430. \u0421\u043F\u0440\u043E\u0431\u0443\u0439 \u0456\u043D\u0448\u0435 \u0444\u043E\u0440\u043C\u0443\u043B\u044E\u0432\u0430\u043D\u043D\u044F \u0430\u0431\u043E semantic=true. \u0426\u0435 \u041D\u0415 \xAB\u043F\u0440\u0430\u043A\u0442\u0438\u043A\u0438 \u043D\u0435\u043C\u0430\u0454\xBB."
    };
  }
  return {
    positions,
    semantic,
    note: fallbackNote + (positions.length === 0 ? "0 \u043F\u043E\u0437\u0438\u0446\u0456\u0439. \u0426\u0435 \u041D\u0415 \xAB\u043F\u0440\u0430\u043A\u0442\u0438\u043A\u0438 \u043D\u0435\u043C\u0430\u0454\xBB \u2014 \u0441\u043F\u0440\u043E\u0431\u0443\u0439 \u0456\u043D\u0448\u0435 \u0444\u043E\u0440\u043C\u0443\u043B\u044E\u0432\u0430\u043D\u043D\u044F, \u0441\u0435\u043C\u0430\u043D\u0442\u0438\u0447\u043D\u0438\u0439 \u043F\u043E\u0448\u0443\u043A (semantic=true), \u0434\u0430\u0439\u0434\u0436\u0435\u0441\u0442\u0438 \u0412\u0421 \u0456 \u0404\u0414\u0420\u0421\u0420." : (semantic ? "\u0421\u0435\u043C\u0430\u043D\u0442\u0438\u0447\u043D\u0438\u0439 \u043F\u043E\u0448\u0443\u043A \u043F\u043E\u0432\u0435\u0440\u0442\u0430\u0454 \u043D\u0430\u0439\u0431\u043B\u0438\u0436\u0447\u0435 \u0437\u0430 \u0437\u043C\u0456\u0441\u0442\u043E\u043C \u0437\u0430\u0432\u0436\u0434\u0438, \u043D\u0430\u0432\u0456\u0442\u044C \u043A\u043E\u043B\u0438 \u0442\u043E\u0447\u043D\u043E\u0433\u043E \u0437\u0431\u0456\u0433\u0443 \u043D\u0435\u043C\u0430\u0454 \u2014 \u043F\u0435\u0440\u0435\u0432\u0456\u0440, \u0449\u043E \u043A\u043E\u0436\u043D\u0430 \u043F\u043E\u0437\u0438\u0446\u0456\u044F \u0441\u043F\u0440\u0430\u0432\u0434\u0456 \u043F\u0440\u043E \u0442\u0432\u043E\u0454 \u043F\u0438\u0442\u0430\u043D\u043D\u044F. " : "") + "\u0426\u0435 \u0444\u0440\u0430\u0433\u043C\u0435\u043D\u0442\u0438 \u0434\u043B\u044F \u0432\u0456\u0434\u0431\u043E\u0440\u0443 \u2014 \u043F\u043E\u0432\u043D\u0438\u0439 \u0442\u0435\u043A\u0441\u0442 \u043F\u043E\u0437\u0438\u0446\u0456\u0457 \u0434\u0430\u0454 lpd_position. \u0426\u0438\u0442\u0443\u0439 \u041F\u041E\u0421\u0422\u0410\u041D\u041E\u0412\u0423, \u0434\u043E \u044F\u043A\u043E\u0457 \u043F\u0440\u0438\u0432'\u044F\u0437\u0430\u043D\u0430 \u043F\u043E\u0437\u0438\u0446\u0456\u044F, \u0430 \u043D\u0435 \u0441\u0430\u043C\u0443 \u041B\u041F\u0414. \u041F\u0435\u0440\u0435\u0432\u0456\u0440, \u0447\u0438 \u043D\u0435 \u0431\u0443\u043B\u043E \u0432\u0456\u0434\u0441\u0442\u0443\u043F\u0443 \u0432\u0456\u0434 \u0446\u0456\u0454\u0457 \u043F\u043E\u0437\u0438\u0446\u0456\u0457.")
  };
}
async function position(id) {
  if (!/^\d+$/.test(id)) {
    throw new SourceError(`\u041B\u041F\u0414 id \u043C\u0430\u0454 \u0431\u0443\u0442\u0438 \u0447\u0438\u0441\u043B\u043E\u043C, \u043E\u0442\u0440\u0438\u043C\u0430\u043D\u043E \xAB${id}\xBB.`, "input");
  }
  const raw = await call(`/legal-position/${id}`);
  const docs = Array.isArray(raw?.documents) ? raw.documents : [];
  return {
    title: stripTags(raw?.title),
    text: htmlToText(String(raw?.text ?? "")),
    valid: raw?.status !== false,
    mark: raw?.mark ?? null,
    decisions: docs.map((d) => ({
      title: stripTags(d?.title),
      case_number: String(d?.caseNumber ?? ""),
      date: String(d?.law_date ?? ""),
      edrsr_id: d?.doc_id ? String(d.doc_id) : null,
      edrsr_url: d?.doc_id ? `https://reyestr.court.gov.ua/Review/${d.doc_id}` : null
    })),
    linked_positions: (Array.isArray(raw?.linkedLegalPositions) ? raw.linkedLegalPositions : []).map((l) => Number(l?.id)).filter(Number.isFinite)
  };
}
var MAX_DIGEST_HITS = 40;
async function searchDigests(query) {
  const payload = await call("/digest/search", { query });
  const total = typeof payload?.totalMatches === "number" ? payload.totalMatches : null;
  const digests = typeof payload?.totalDigests === "number" ? payload.totalDigests : null;
  const all = items(payload);
  const hits = all.slice(0, MAX_DIGEST_HITS).map((r) => ({
    title: stripTags(r.title),
    type: stripTags(r.typeLabel),
    page: stripTags(r.pageLabel),
    snippet: stripTags(r.snippet),
    pdfUrl: typeof r.externalUrl === "string" ? r.externalUrl : void 0
  }));
  return {
    totalMatches: total,
    totalDigests: digests,
    countCapped: total === 100,
    hits,
    note: (all.length > MAX_DIGEST_HITS ? `\u041F\u043E\u043A\u0430\u0437\u0430\u043D\u043E ${MAX_DIGEST_HITS} \u0437 ${all.length} \u0437\u0431\u0456\u0433\u0456\u0432 \u2014 \u0437\u0432\u0443\u0437\u044C \u0437\u0430\u043F\u0438\u0442. ` : "") + (total === 100 ? "\u041B\u0456\u0447\u0438\u043B\u044C\u043D\u0438\u043A \u043E\u0431\u0440\u0456\u0437\u0430\u043D\u043E \u043D\u0430 100 \u2014 \u043D\u0435 \u043F\u043E\u0434\u0430\u0432\u0430\u0439 \u0446\u0435 \u044F\u043A \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0443. " : "") + "\u041E\u0433\u043B\u044F\u0434 \u0412\u0421 \u2014 \u043E\u0444\u0456\u0446\u0456\u0439\u043D\u0435 \u0443\u0437\u0430\u0433\u0430\u043B\u044C\u043D\u0435\u043D\u043D\u044F \u0441\u0430\u043C\u043E\u0433\u043E \u0441\u0443\u0434\u0443, \u0430\u043B\u0435 \u041D\u0415 \u0434\u0436\u0435\u0440\u0435\u043B\u043E \u043F\u0440\u0430\u0432\u0430. \u0414\u043B\u044F \u0430\u0440\u0433\u0443\u043C\u0435\u043D\u0442\u0443 \u0446\u0438\u0442\u0443\u0439 \u043F\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0443, \u043D\u0430 \u044F\u043A\u0443 \u043E\u0433\u043B\u044F\u0434 \u043F\u043E\u0441\u0438\u043B\u0430\u0454\u0442\u044C\u0441\u044F."
  };
}

// src/edrsr.ts
var BASE = "https://reyestr.court.gov.ua";
var MAX_DOCS = 8;
function courtDateRange(from, to) {
  const native = (value) => {
    if (!value) return void 0;
    const [d, m, y] = value.includes("-") ? value.split("-").reverse() : value.split(".");
    if (!isRealDate(`${y}-${m}-${d}`)) {
      throw new SourceError(`\u0414\u0430\u0442\u0438 \xAB${value}\xBB \u043D\u0435\u043C\u0430\u0454 \u0432 \u043A\u0430\u043B\u0435\u043D\u0434\u0430\u0440\u0456.`, "input");
    }
    return { native: `${d}.${m}.${y}`, sortable: `${y}${m}${d}` };
  };
  const a = native(from);
  const b = native(to);
  if (a && b && a.sortable > b.sortable) {
    throw new SourceError(`date_from ${from} \u043F\u0456\u0437\u043D\u0456\u0448\u0435 \u0437\u0430 date_to ${to}.`, "input");
  }
  return { dateFrom: a?.native, dateTo: b?.native };
}
var BLOCK = /(перевірка\s+безпеки|доступ\s+(?:обмежено|заборонено)|занадто\s+багато\s+запитів|too\s+many\s+requests|тимчасово\s+недоступн)/i;
var FOUND = /знайдено\s+документів[:\s]*([\d\s  ]+)/i;
var ZERO = /не\s+знайдено\s+жодного\s+документа/i;
function hasDecision(html) {
  return /id="(?:txtdepository|divdocument)"/.test(html);
}
function stripAngles(value) {
  return (value ?? "").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
}
function parseFound(html) {
  const m = FOUND.exec(html);
  if (m) return Number(m[1].replace(/\D/g, "")) || 0;
  return ZERO.test(html) ? 0 : null;
}
function parseRows(html) {
  const out = [];
  for (const tr of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    if (!tr.includes("/Review/")) continue;
    const rid = /\/Review\/(\d+)/.exec(tr);
    if (!rid) continue;
    const cells = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? []).map(
      (c) => htmlToText(c).replace(/\s+/g, " ").trim()
    );
    if (cells.length < 8) continue;
    out.push({
      id: rid[1],
      form: cells[1],
      adjudicatedAt: cells[2],
      publishedAt: cells[3],
      proceedingForm: cells[4],
      caseNumber: cells[5],
      court: cells[6],
      judge: cells[7],
      url: `${BASE}/Review/${rid[1]}`
    });
  }
  return out;
}
function filterByCase(rows, caseNumber) {
  if (!caseNumber) return { rows, substringOnly: false };
  const want = caseNumber.replace(/\s/g, "");
  const kept = rows.filter(
    (r) => r.caseNumber.replace(/\s/g, "").startsWith(want)
  );
  return { rows: kept, substringOnly: kept.length === 0 && rows.length > 0 };
}
function isErdr(value) {
  return /^\d{17}$/.test((value ?? "").replace(/\s/g, ""));
}
async function search(input) {
  resetBudget();
  const erdr = isErdr(input.caseNumber);
  const expression = erdr ? [input.expression, input.caseNumber.replace(/\s/g, "")].filter(Boolean).join(" ") : input.expression;
  const caseNumber = erdr ? void 0 : input.caseNumber;
  const erdrNote = erdr ? "\u041D\u043E\u043C\u0435\u0440 \u0404\u0420\u0414\u0420 \u0448\u0443\u043A\u0430\u043D\u043E \u044F\u043A \u0442\u0435\u043A\u0441\u0442 \u0437\u0430\u043F\u0438\u0442\u0443: \u043F\u043E\u043B\u0435 \u043D\u043E\u043C\u0435\u0440\u0430 \u0441\u043F\u0440\u0430\u0432\u0438 \u043F\u0440\u0438\u0439\u043C\u0430\u0454 \u043B\u0438\u0448\u0435 \u0404\u0423\u041D \u0441\u0443\u0434\u0443. " : "";
  const form = {
    SearchExpression: stripAngles(expression),
    CaseNumber: stripAngles(caseNumber),
    RegNumber: stripAngles(input.regNumber),
    ChairmenName: stripAngles(input.judge),
    UserCourtCode: stripAngles(input.courtCode),
    RegDateBegin: stripAngles(input.dateFrom),
    RegDateEnd: stripAngles(input.dateTo),
    ImportDateBegin: "",
    ImportDateEnd: "",
    Sort: "0",
    "PagingInfo.ItemsPerPage": "100"
  };
  const res = await request("edrsr", { path: "/", form });
  if (res.status !== 200) {
    return {
      status: "http_error",
      found: null,
      countCapped: false,
      rows: [],
      note: `HTTP ${res.status}. \u041F\u043E\u0448\u0443\u043A \u041D\u0415 \u0432\u0438\u043A\u043E\u043D\u0430\u043D\u043E \u2014 \u043D\u0435 \u0440\u043E\u0431\u0438 \u0437 \u0446\u044C\u043E\u0433\u043E \u0432\u0438\u0441\u043D\u043E\u0432\u043A\u0443, \u0449\u043E \u0441\u043F\u0440\u0430\u0432\u0438 \u0430\u0431\u043E \u043F\u0440\u0430\u043A\u0442\u0438\u043A\u0438 \u043D\u0435 \u0456\u0441\u043D\u0443\u0454.`
    };
  }
  const found = parseFound(res.body);
  const rows = parseRows(res.body);
  if (found === null && rows.length === 0) {
    if (BLOCK.test(res.body)) {
      return {
        status: "blocked",
        found: null,
        countCapped: false,
        rows: [],
        note: "\u0421\u0422\u041E\u041F: \u0440\u0435\u0454\u0441\u0442\u0440 \u043F\u043E\u043A\u0430\u0437\u0430\u0432 \u0431\u043B\u043E\u043A-\u0441\u0442\u043E\u0440\u0456\u043D\u043A\u0443. \u041E\u0431\u0445\u0456\u0434 \u043D\u0435 \u0432\u0438\u043A\u043E\u043D\u0443\u0454\u0442\u044C\u0441\u044F. \u041F\u043E\u0432\u0456\u0434\u043E\u043C \u043A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0430 \u0456 \u0441\u043F\u0440\u043E\u0431\u0443\u0439 \u043F\u0456\u0437\u043D\u0456\u0448\u0435."
      };
    }
    return {
      status: "no_results_view",
      found: null,
      countCapped: false,
      rows: [],
      note: "\u0421\u0442\u043E\u0440\u0456\u043D\u043A\u0430 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u0456\u0432 \u043D\u0435 \u0432\u0456\u0434\u0440\u0435\u043D\u0434\u0435\u0440\u0438\u043B\u0430\u0441\u044C (\u043D\u0456 \u043B\u0456\u0447\u0438\u043B\u044C\u043D\u0438\u043A\u0430, \u043D\u0456 \u0440\u044F\u0434\u043A\u0456\u0432). \u0426\u0435 \u041D\u0415 \xAB\u043D\u0456\u0447\u043E\u0433\u043E \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E\xBB, \u0430 \u0437\u043B\u0430\u043C\u0430\u043D\u0438\u0439 \u0437\u0430\u043F\u0438\u0442 \u0430\u0431\u043E \u043C'\u044F\u043A\u0438\u0439 \u0431\u043B\u043E\u043A. \u041D\u0435 \u0440\u043E\u0431\u0438 \u0432\u0438\u0441\u043D\u043E\u0432\u043A\u0443 \u043F\u0440\u043E \u0432\u0456\u0434\u0441\u0443\u0442\u043D\u0456\u0441\u0442\u044C \u0441\u043F\u0440\u0430\u0432\u0438."
    };
  }
  const { rows: filtered, substringOnly } = filterByCase(rows, caseNumber);
  if (filtered.length === 0) {
    return {
      status: "zero",
      found,
      countCapped: found === 1e5,
      rows: [],
      note: erdrNote + (substringOnly ? `\u0420\u0435\u0454\u0441\u0442\u0440 \u043F\u043E\u0432\u0435\u0440\u043D\u0443\u0432 ${rows.length} \u0440\u044F\u0434\u043A\u0456\u0432, \u0430\u043B\u0435 \u0436\u043E\u0434\u0435\u043D \u043D\u0435 \u043D\u0430\u043B\u0435\u0436\u0438\u0442\u044C \u0441\u043F\u0440\u0430\u0432\u0456 ${caseNumber} \u2014 \u043F\u043E\u0448\u0443\u043A \u0437\u0430 \u043D\u043E\u043C\u0435\u0440\u043E\u043C \u0441\u043F\u0440\u0430\u0432\u0438 \u043F\u0440\u0430\u0446\u044E\u0454 \u044F\u043A \u043F\u043E\u0448\u0443\u043A \u043F\u0456\u0434\u0440\u044F\u0434\u043A\u0430. \u0414\u043B\u044F \u0446\u0456\u0454\u0457 \u0441\u043F\u0440\u0430\u0432\u0438 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u043D\u0443\u043B\u044C\u043E\u0432\u0438\u0439. ` : "") + "\u041D\u0423\u041B\u042C \u0440\u044F\u0434\u043A\u0456\u0432. \u0426\u0435 \xAB\u044F \u043D\u0435 \u0437\u043D\u0430\u0439\u0448\u043E\u0432\xBB, \u0430 \u043D\u0435 \xAB\u043F\u0440\u0430\u043A\u0442\u0438\u043A\u0438/\u0441\u043F\u0440\u0430\u0432\u0438 \u043D\u0435\u043C\u0430\u0454\xBB. \u041F\u0435\u0440\u0435\u0432\u0456\u0440: \u0432\u0456\u0434\u043C\u0456\u043D\u043E\u043A (\u0434\u043E\u0434\u0430\u0439 `*` \u0434\u043B\u044F \u043C\u043E\u0440\u0444\u043E\u043B\u043E\u0433\u0456\u0457), \u0441\u0442\u043E\u043F-\u0441\u043B\u043E\u0432\u0430 (\u041E\u0421\u041E\u0411\u0410, \u0410\u0414\u0420\u0415\u0421\u0410, \u0433\u0440\u043D), \u043B\u0456\u0442\u0435\u0440\u043D\u0438\u0439 \u0441\u0443\u0444\u0456\u043A\u0441 \u0443 \u043D\u043E\u043C\u0435\u0440\u0456 \u0441\u043F\u0440\u0430\u0432\u0438. \u041D\u043E\u043C\u0435\u0440 \u0404\u0420\u0414\u0420 \u0448\u0443\u043A\u0430\u0454\u0442\u044C\u0441\u044F \u044F\u043A \u0442\u0435\u043A\u0441\u0442 \u0437\u0430\u043F\u0438\u0442\u0443 (expression), \u043D\u0435 \u044F\u043A \u043D\u043E\u043C\u0435\u0440 \u0441\u043F\u0440\u0430\u0432\u0438."
    };
  }
  return {
    status: "ok",
    found,
    countCapped: found === 1e5,
    rows: filtered,
    note: erdrNote + "\u041F\u043E\u0441\u0438\u043B\u0430\u043D\u043D\u044F \u043B\u0438\u0448\u0435 \u044F\u043A https://reyestr.court.gov.ua/Review/<id> \u2014 URL \u043F\u043E\u0448\u0443\u043A\u0443 \u043D\u0435 \u0456\u0441\u043D\u0443\u0454, \u043F\u043E\u0448\u0443\u043A \u043F\u0440\u0430\u0446\u044E\u0454 \u0442\u0456\u043B\u044C\u043A\u0438 \u0447\u0435\u0440\u0435\u0437 POST. \u041F\u0440\u043E\u0446\u0435\u0441\u0443\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u0441\u0442\u0430\u043D\u0443 (\u0447\u0438 \u043D\u0430\u0431\u0440\u0430\u043B\u043E \u0440\u0456\u0448\u0435\u043D\u043D\u044F \u0441\u0438\u043B\u0438) \u0432 \u0404\u0414\u0420\u0421\u0420 \u041D\u0415\u041C\u0410\u0404 \u2014 \u0446\u0435 court.gov.ua/fair."
  };
}
var transit = /* @__PURE__ */ new Map();
var lastDocAt = 0;
var IDLE_RESET_MS = 10 * 60 * 1e3;
function docsFetched() {
  return [...transit.keys()];
}
function resetBudget() {
  transit.clear();
  lastDocAt = 0;
}
function expireIdleBudget() {
  if (lastDocAt && Date.now() - lastDocAt > IDLE_RESET_MS) resetBudget();
}
function trimChrome(text2) {
  const start = text2.indexOf("\u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0456\u044F \u0441\u043F\u0440\u0430\u0432\u0438 \u2116");
  const end = text2.indexOf("\u0412\u0432\u0435\u0434\u0456\u0442\u044C, \u0431\u0443\u0434\u044C \u043B\u0430\u0441\u043A\u0430, \u043B\u043E\u0433\u0456\u043D \u0442\u0430 \u043F\u0430\u0440\u043E\u043B\u044C");
  return text2.slice(start >= 0 ? start : 0, end > start ? end : text2.length).trim();
}
var OPERATIVE = new RegExp(
  `^\\s*(?:${["\u043F\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u043B\u0430", "\u043F\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0432", "\u0443\u0445\u0432\u0430\u043B\u0438\u043B\u0430", "\u0443\u0445\u0432\u0430\u043B\u0438\u0432", "\u0432\u0438\u0440\u0456\u0448\u0438\u043B\u0430", "\u0432\u0438\u0440\u0456\u0448\u0438\u0432", "\u0437\u0430\u0441\u0443\u0434\u0438\u043B\u0430", "\u0437\u0430\u0441\u0443\u0434\u0438\u0432"].map((w) => [...w].join("\\s*")).join("|")})\\s*:?\\s*$`,
  "gimu"
);
function findOperative(text2) {
  let at = -1;
  for (const m of text2.matchAll(OPERATIVE)) at = m.index;
  return at;
}
var CHUNK = 2e4;
var MAX_HITS = 25;
function grepExcerpts(body, needle) {
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  const windows = [];
  let hits = 0;
  for (const m of body.matchAll(re)) {
    if (hits === MAX_HITS) return { excerpts: cut(), hits, capped: true };
    hits++;
    const from = Math.max(0, m.index - 400);
    const to = Math.min(body.length, m.index + m[0].length + 600);
    const last = windows.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else windows.push([from, to]);
  }
  return { excerpts: cut(), hits, capped: false };
  function cut() {
    return windows.map(([from, to]) => body.slice(from, to).trim());
  }
}
async function document(id, mode = "head", needle) {
  if (!/^\d+$/.test(id)) {
    throw new SourceError(`\u0404\u0414\u0420\u0421\u0420 id \u043C\u0430\u0454 \u0431\u0443\u0442\u0438 \u0447\u0438\u0441\u043B\u043E\u043C, \u043E\u0442\u0440\u0438\u043C\u0430\u043D\u043E \xAB${id}\xBB.`, "input");
  }
  expireIdleBudget();
  let body = transit.get(id);
  if (body === void 0) {
    if (transit.size >= MAX_DOCS) {
      throw new SourceError(
        `\u041B\u0456\u043C\u0456\u0442 ${MAX_DOCS} \u0423\u041D\u0406\u041A\u0410\u041B\u042C\u041D\u0418\u0425 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0456\u0432 \u043D\u0430 \u043F\u0438\u0442\u0430\u043D\u043D\u044F \u0434\u043E\u0441\u044F\u0433\u043D\u0443\u0442\u043E. \u0412\u0436\u0435 \u0437\u0430\u0432\u0430\u043D\u0442\u0430\u0436\u0435\u043D\u0456 \u0447\u0438\u0442\u0430\u044E\u0442\u044C\u0441\u044F \u0431\u0435\u0437\u043A\u043E\u0448\u0442\u043E\u0432\u043D\u043E: ${docsFetched().join(", ")}. \u041D\u043E\u0432\u0438\u0439 \u043F\u043E\u0448\u0443\u043A (edrsr_search) \u043F\u043E\u0447\u0438\u043D\u0430\u0454 \u043D\u043E\u0432\u0435 \u043F\u0438\u0442\u0430\u043D\u043D\u044F \u0456 \u0441\u043A\u0438\u0434\u0430\u0454 \u043B\u0456\u043C\u0456\u0442.`,
        "budget"
      );
    }
    const res = await request("edrsr", { path: `/Review/${id}` });
    if (res.status !== 200) {
      throw new SourceError(
        `\u0404\u0414\u0420\u0421\u0420: HTTP ${res.status} \u0434\u043B\u044F \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430 ${id}. \u041D\u0435 \u043F\u0435\u0440\u0435\u0432\u0456\u0440\u0435\u043D\u043E.`,
        "http"
      );
    }
    if (!hasDecision(res.body)) {
      if (BLOCK.test(res.body)) {
        throw new SourceError(
          "\u0421\u0422\u041E\u041F: \u0440\u0435\u0454\u0441\u0442\u0440 \u043F\u043E\u043A\u0430\u0437\u0430\u0432 \u0431\u043B\u043E\u043A-\u0441\u0442\u043E\u0440\u0456\u043D\u043A\u0443. \u041E\u0431\u0445\u0456\u0434 \u043D\u0435 \u0432\u0438\u043A\u043E\u043D\u0443\u0454\u0442\u044C\u0441\u044F.",
          "blocked"
        );
      }
      throw new SourceError(
        `\u0417\u0430 id ${id} \u0440\u0435\u0454\u0441\u0442\u0440 \u043D\u0435 \u043F\u043E\u043A\u0430\u0437\u0430\u0432 \u0442\u0435\u043A\u0441\u0442\u0443 \u0440\u0456\u0448\u0435\u043D\u043D\u044F: \u0442\u0430\u043A\u043E\u0433\u043E \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430 \u043D\u0435\u043C\u0430\u0454 \u0430\u0431\u043E \u0434\u043E\u0441\u0442\u0443\u043F \u0434\u043E \u043D\u044C\u043E\u0433\u043E \u043E\u0431\u043C\u0435\u0436\u0435\u043D\u043E. \u0426\u0435 \u041D\u0415 \u0434\u043E\u043A\u0430\u0437, \u0449\u043E \u0440\u0456\u0448\u0435\u043D\u043D\u044F \u043D\u0435 \u0456\u0441\u043D\u0443\u0454 \u2014 \u043F\u0435\u0440\u0435\u0432\u0456\u0440 id \u0443 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u0430\u0445 edrsr_search.`,
        "unavailable"
      );
    }
    body = trimChrome(htmlToText(res.body));
    transit.set(id, body);
    lastDocAt = Date.now();
  }
  const url = `${BASE}/Review/${id}`;
  const total = body.length;
  let text2;
  let note = "";
  if (mode === "operative") {
    const at = findOperative(body);
    if (at >= 0) {
      text2 = body.slice(at).slice(0, CHUNK);
      note = "\u0420\u0435\u0437\u043E\u043B\u044E\u0442\u0438\u0432\u043D\u0430 \u0447\u0430\u0441\u0442\u0438\u043D\u0430 \u2014 \u0442\u0435, \u0447\u0438\u043C \u0441\u043F\u0440\u0430\u0432\u0430 \u0437\u0430\u043A\u0456\u043D\u0447\u0438\u043B\u0430\u0441\u044C.";
    } else {
      text2 = body.slice(-CHUNK);
      note = "\u041C\u0430\u0440\u043A\u0435\u0440 \u0440\u0435\u0437\u043E\u043B\u044E\u0442\u0438\u0432\u043D\u043E\u0457 \u0447\u0430\u0441\u0442\u0438\u043D\u0438 \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E \u2014 \u043F\u043E\u043A\u0430\u0437\u0430\u043D\u043E \u043A\u0456\u043D\u0435\u0446\u044C \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430. \u041F\u0435\u0440\u0435\u043A\u043E\u043D\u0430\u0439\u0441\u044F, \u0449\u043E \u0446\u0435 \u0441\u043F\u0440\u0430\u0432\u0434\u0456 \u0440\u0435\u0437\u043E\u043B\u044E\u0442\u0438\u0432\u043D\u0430 \u0447\u0430\u0441\u0442\u0438\u043D\u0430.";
    }
  } else if (mode === "grep") {
    if (!needle) {
      throw new SourceError("mode=grep \u043F\u043E\u0442\u0440\u0435\u0431\u0443\u0454 \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u0430 needle.", "input");
    }
    const { excerpts, hits, capped } = grepExcerpts(body, needle);
    text2 = excerpts.length ? excerpts.join("\n\n\u2014 \u2014 \u2014\n\n") : `\u0421\u043B\u043E\u0432\u0430 \xAB${needle}\xBB \u0443 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0456 ${id} \u043D\u0435\u043C\u0430\u0454.`;
    note = capped ? `\u041F\u043E\u043A\u0430\u0437\u0430\u043D\u043E \u043F\u0435\u0440\u0448\u0456 ${MAX_HITS} \u0437\u0433\u0430\u0434\u043E\u043A \u2014 \u0457\u0445 \u043C\u043E\u0436\u0435 \u0431\u0443\u0442\u0438 \u0431\u0456\u043B\u044C\u0448\u0435. \u0417\u0432\u0443\u0437\u044C \u0441\u043B\u043E\u0432\u043E, \u044F\u043A\u0449\u043E \u043F\u043E\u0442\u0440\u0456\u0431\u0435\u043D \u0442\u043E\u0447\u043D\u0456\u0448\u0438\u0439 \u0437\u0440\u0456\u0437.` : `${hits} \u0437\u0433\u0430\u0434\u043E\u043A.`;
  } else if (mode === "tail") {
    text2 = body.slice(-CHUNK);
  } else {
    text2 = body.slice(0, CHUNK);
    if (total > CHUNK) {
      note = `\u041F\u043E\u043A\u0430\u0437\u0430\u043D\u043E \u043F\u0435\u0440\u0448\u0456 ${CHUNK} \u0437 ${total} \u0437\u043D\u0430\u043A\u0456\u0432. \u042F\u043A\u0449\u043E \u043F\u043E\u0442\u0440\u0456\u0431\u043D\u043E, \u0447\u0438\u043C \u0441\u043F\u0440\u0430\u0432\u0430 \u0437\u0430\u043A\u0456\u043D\u0447\u0438\u043B\u0430\u0441\u044C \u2014 \u0432\u0438\u043A\u043E\u0440\u0438\u0441\u0442\u0430\u0439 mode=operative, \u0430 \u043D\u0435 \u0447\u0438\u0442\u0430\u0439 \u0434\u0430\u043B\u0456.`;
    }
  }
  lastDocAt = Date.now();
  return { id, url, mode, text: text2, totalChars: total, note };
}
var ANONYMISATION_NOTE = "\u0410\u043D\u043E\u043D\u0456\u043C\u0456\u0437\u0430\u0446\u0456\u044F (\u0441\u0442. 7 \u0417\u0423 \u2116 3262-IV): \u044F\u043A\u0449\u043E \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442 \u043C\u0456\u0441\u0442\u0438\u0442\u044C \u0441\u043F\u0440\u0430\u0432\u0436\u043D\u0456 \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u043B\u044C\u043D\u0456 \u0434\u0430\u043D\u0456, \u041D\u0415 \u043F\u0435\u0440\u0435\u043D\u043E\u0441\u0438 \u0457\u0445 \u0443 \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u044C \u0456 \u041D\u0406\u041A\u041E\u041B\u0418 \u043D\u0435 \u0437\u0432'\u044F\u0437\u0443\u0439 \u041E\u0421\u041E\u0411\u0410_N \u043C\u0456\u0436 \u0440\u0456\u0437\u043D\u0438\u043C\u0438 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430\u043C\u0438.";

// src/index.ts
var INSTRUCTIONS = "\u0423\u043A\u0440\u0430\u0457\u043D\u0441\u044C\u043A\u0456 \u043F\u0440\u0430\u0432\u043E\u0432\u0456 \u0434\u0436\u0435\u0440\u0435\u043B\u0430 \u0437 \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0457 \u043C\u0430\u0448\u0438\u043D\u0438. \u0412\u0438\u043A\u043E\u0440\u0438\u0441\u0442\u043E\u0432\u0443\u0439 \u0446\u0456 \u0456\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442\u0438 \u0437\u0430\u043C\u0456\u0441\u0442\u044C web fetch: rada_* \u0434\u043B\u044F \u0437\u0430\u043A\u043E\u043D\u043E\u0434\u0430\u0432\u0441\u0442\u0432\u0430 (\u043E\u0444\u0456\u0446\u0456\u0439\u043D\u0435 API data.rada.gov.ua), lpd_* \u0434\u043B\u044F \u043F\u0440\u0430\u0432\u043E\u0432\u0438\u0445 \u043F\u043E\u0437\u0438\u0446\u0456\u0439 \u0412\u0421, edrsr_* \u0434\u043B\u044F \u0440\u0435\u0454\u0441\u0442\u0440\u0443 \u0441\u0443\u0434\u043E\u0432\u0438\u0445 \u0440\u0456\u0448\u0435\u043D\u044C. \u041D\u0456\u043A\u043E\u043B\u0438 \u043D\u0435 \u0446\u0438\u0442\u0443\u0439 \u043D\u043E\u0440\u043C\u0443 \u0437 \u043F\u0430\u043C'\u044F\u0442\u0456. \u041F\u043E\u0440\u043E\u0436\u043D\u0456\u0439 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u043E\u0437\u043D\u0430\u0447\u0430\u0454 \xAB\u044F \u043D\u0435 \u0437\u043D\u0430\u0439\u0448\u043E\u0432\xBB, \u0430 \u043D\u0435 \xAB\u0446\u044C\u043E\u0433\u043E \u043D\u0435 \u0456\u0441\u043D\u0443\u0454\xBB. \u0421\u0442\u0430\u043D\u0443 \u0441\u043F\u0440\u0430\u0432\u0438 (\u0447\u0438 \u043D\u0430\u0431\u0440\u0430\u043B\u043E \u0440\u0456\u0448\u0435\u043D\u043D\u044F \u0441\u0438\u043B\u0438) \u0442\u0443\u0442 \u043D\u0435\u043C\u0430\u0454 \u2014 court.gov.ua/fair \u043F\u0456\u0434 reCAPTCHA.";
var now = () => (/* @__PURE__ */ new Date()).toISOString();
var text = (rule) => ({ type: "string", ...rule });
var NREG = (description) => text({ minLength: 2, maxLength: 64, description });
var ID = (description) => text({ pattern: "^\\d{1,12}$", ...description ? { description } : {} });
var ISO_DATE = (description) => text({ pattern: "^\\d{4}-\\d{2}-\\d{2}$", ...description ? { description } : {} });
var COURT_DATE = text({
  pattern: "^(\\d{2}\\.\\d{2}\\.\\d{4}|\\d{4}-\\d{2}-\\d{2})$",
  description: "DD.MM.YYYY (YYYY-MM-DD \u0442\u0435\u0436 \u043F\u0440\u0438\u0439\u043C\u0430\u0454\u0442\u044C\u0441\u044F)"
});
var schema = (properties, required = []) => ({
  type: "object",
  properties,
  ...required.length ? { required } : {}
});
var tools = [];
function tool(def) {
  tools.push({
    ...def,
    annotations: { readOnlyHint: true, openWorldHint: true },
    handler: def.handler
  });
}
function ok(payload) {
  return {
    content: [
      { type: "text", text: JSON.stringify(payload) }
    ]
  };
}
function fail(err) {
  const e = err;
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            error: e?.message ?? String(err),
            kind: e?.kind ?? "unknown",
            verified: false,
            // An input error never reached a source; saying "the source did not
            // answer" would send the model looking for an outage.
            reminder: e?.kind === "input" ? "\u0417\u0430\u043F\u0438\u0442 \u043D\u0435 \u043D\u0430\u0434\u0456\u0441\u043B\u0430\u043D\u043E: \u0432\u0438\u043F\u0440\u0430\u0432 \u0432\u0445\u0456\u0434\u043D\u0456 \u0434\u0430\u043D\u0456 \u0439 \u043F\u043E\u0432\u0442\u043E\u0440\u0438." : e?.kind === "unavailable" ? "\u0414\u0436\u0435\u0440\u0435\u043B\u043E \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u043B\u043E, \u0430\u043B\u0435 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430 \u043D\u0435 \u043F\u043E\u043A\u0430\u0437\u0430\u043B\u043E. \u041D\u0435 \u0446\u0438\u0442\u0443\u0439 \u0439\u043E\u0433\u043E \u0437 \u043F\u0430\u043C'\u044F\u0442\u0456 \u0456 \u043D\u0435 \u0441\u0442\u0432\u0435\u0440\u0434\u0436\u0443\u0439, \u0449\u043E \u0439\u043E\u0433\u043E \u043D\u0435 \u0456\u0441\u043D\u0443\u0454." : "\u0414\u0436\u0435\u0440\u0435\u043B\u043E \u043D\u0435 \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u043B\u043E. \u0426\u0435 \u041D\u0415 \u043F\u0456\u0434\u0441\u0442\u0430\u0432\u0430 \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u0430\u0442\u0438 \u0437 \u043F\u0430\u043C'\u044F\u0442\u0456 \u0456 \u041D\u0415 \u0434\u043E\u043A\u0430\u0437 \u0432\u0456\u0434\u0441\u0443\u0442\u043D\u043E\u0441\u0442\u0456 \u043D\u043E\u0440\u043C\u0438 \u0447\u0438 \u0441\u043F\u0440\u0430\u0432\u0438."
          }
        )
      }
    ]
  };
}
async function guard(fn) {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}
var TOOL_BUDGET_MS = 45e3;
var KEEP_MS = 10 * 6e4;
var running = /* @__PURE__ */ new Map();
function budgeted(name, handler) {
  return async (args) => {
    const started = Date.now();
    for (const [k, v] of running) if (started - v.at > KEEP_MS) running.delete(k);
    const key = `${name}:${JSON.stringify(args)}`;
    let entry = running.get(key);
    if (!entry) {
      entry = { work: handler(args), at: started };
      running.set(key, entry);
    }
    const work = entry.work;
    let timer;
    const deadline = new Promise((resolve2) => {
      timer = setTimeout(() => resolve2("pending"), TOOL_BUDGET_MS);
    });
    const result = await Promise.race([work, deadline]);
    clearTimeout(timer);
    if (result !== "pending") {
      running.delete(key);
      return result;
    }
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: `\u0414\u0436\u0435\u0440\u0435\u043B\u043E \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u0430\u0454 \u043F\u043E\u0432\u0456\u043B\u044C\u043D\u043E (\u043B\u0456\u043C\u0456\u0442\u0438 \u0432\u0432\u0456\u0447\u043B\u0438\u0432\u043E\u0441\u0442\u0456 \u0434\u0435\u0440\u0436\u0430\u0432\u043D\u0438\u0445 \u0441\u0430\u0439\u0442\u0456\u0432), \u0442\u043E\u0436 \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u044C \u0449\u0435 \u043D\u0435 \u0433\u043E\u0442\u043E\u0432\u0430. \u0420\u043E\u0431\u043E\u0442\u0430 \u0442\u0440\u0438\u0432\u0430\u0454 \u0443 \u0444\u043E\u043D\u0456.`,
            kind: "pending",
            verified: false,
            reminder: "\u041F\u043E\u0432\u0442\u043E\u0440\u0438 \u0422\u041E\u0419 \u0421\u0410\u041C\u0418\u0419 \u0432\u0438\u043A\u043B\u0438\u043A \u0437 \u0442\u0438\u043C\u0438 \u0441\u0430\u043C\u0438\u043C\u0438 \u0430\u0440\u0433\u0443\u043C\u0435\u043D\u0442\u0430\u043C\u0438 \u0437\u0430 20\u201330 \u0441 \u2014 \u0432\u0456\u043D \u043E\u0442\u0440\u0438\u043C\u0430\u0454 \u0433\u043E\u0442\u043E\u0432\u0438\u0439 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u0431\u0435\u0437 \u043D\u043E\u0432\u043E\u0433\u043E \u0437\u0430\u043F\u0438\u0442\u0443. \u041D\u0435 \u0440\u043E\u0431\u0438 \u0432\u0438\u0441\u043D\u043E\u0432\u043A\u0456\u0432 \u0456 \u043D\u0435 \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u0430\u0439 \u0437 \u043F\u0430\u043C'\u044F\u0442\u0456, \u043F\u043E\u043A\u0438 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u0443 \u043D\u0435\u043C\u0430\u0454."
          })
        }
      ]
    };
  };
}
async function textAsOf(rawNreg, date) {
  const meta = await getMeta(rawNreg);
  const current = () => getText(meta.nreg, void 0, meta.currentRedaction);
  if (!date) {
    return {
      meta,
      text: await current(),
      asOf: null,
      redactionDate: meta.currentRedaction,
      note: `\u041F\u043E\u0442\u043E\u0447\u043D\u0430 \u0440\u0435\u0434\u0430\u043A\u0446\u0456\u044F \u0432\u0456\u0434 ${meta.currentRedaction}.`
    };
  }
  if (!isRealDate(date)) {
    throw new SourceError(
      `\u0414\u0430\u0442\u0438 \xAB${date}\xBB \u043D\u0435\u043C\u0430\u0454 \u0432 \u043A\u0430\u043B\u0435\u043D\u0434\u0430\u0440\u0456. \u041F\u0435\u0440\u0435\u0432\u0456\u0440 \u0434\u0435\u043D\u044C \u0456 \u043C\u0456\u0441\u044F\u0446\u044C.`,
      "input"
    );
  }
  const a = redactionAsOf(meta, date, kyivToday());
  if (a.kind === "before") {
    return { meta, text: null, asOf: date, firstRedaction: a.firstRedaction };
  }
  if (a.kind === "future") {
    const pending = meta.futureRedactions.length;
    return {
      meta,
      text: await current(),
      asOf: date,
      redactionDate: meta.currentRedaction,
      note: `${date} \u2014 \u0443 \u043C\u0430\u0439\u0431\u0443\u0442\u043D\u044C\u043E\u043C\u0443. \u041F\u043E\u043A\u0430\u0437\u0430\u043D\u043E \u0447\u0438\u043D\u043D\u0443 \u0441\u044C\u043E\u0433\u043E\u0434\u043D\u0456 \u0440\u0435\u0434\u0430\u043A\u0446\u0456\u044E \u0432\u0456\u0434 ${meta.currentRedaction}. ` + (pending ? `\u0423\u0436\u0435 \u0443\u0445\u0432\u0430\u043B\u0435\u043D\u043E ${pending} \u043C\u0430\u0439\u0431\u0443\u0442\u043D\u0456\u0445 \u0440\u0435\u0434\u0430\u043A\u0446\u0456\u0439, \u0442\u043E\u0436 \u043D\u0430 ${date} \u0442\u0435\u043A\u0441\u0442 \u043C\u043E\u0436\u0435 \u0431\u0443\u0442\u0438 \u0456\u043D\u0448\u0438\u043C.` : `\u0423\u0445\u0432\u0430\u043B\u0435\u043D\u0438\u0445 \u043C\u0430\u0439\u0431\u0443\u0442\u043D\u0456\u0445 \u0440\u0435\u0434\u0430\u043A\u0446\u0456\u0439 \u0440\u0435\u0454\u0441\u0442\u0440 \u043D\u0435 \u043F\u043E\u043A\u0430\u0437\u0443\u0454.`)
    };
  }
  if (a.kind === "no-history") {
    return {
      meta,
      text: await current(),
      asOf: date,
      redactionDate: meta.currentRedaction,
      note: `\u0420\u0435\u0454\u0441\u0442\u0440 \u043D\u0435 \u0432\u0435\u0434\u0435 \u0456\u0441\u0442\u043E\u0440\u0456\u0457 \u0440\u0435\u0434\u0430\u043A\u0446\u0456\u0439 \u0446\u044C\u043E\u0433\u043E \u0430\u043A\u0442\u0430, \u0442\u043E\u0436 \u0442\u0435\u043A\u0441\u0442 \u0441\u0442\u0430\u043D\u043E\u043C \u043D\u0430 ${date} \u0432\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u0438 \u043D\u0435\u043C\u043E\u0436\u043B\u0438\u0432\u043E. \u041F\u043E\u043A\u0430\u0437\u0430\u043D\u043E \u043F\u043E\u0442\u043E\u0447\u043D\u0443 \u0440\u0435\u0434\u0430\u043A\u0446\u0456\u044E \u0432\u0456\u0434 ${meta.currentRedaction} \u2014 \u041D\u0415 \u043F\u043E\u0434\u0430\u0432\u0430\u0439 \u0457\u0457 \u044F\u043A \u0442\u0435\u043A\u0441\u0442 \u043D\u0430 ${date}.`
    };
  }
  const r = a.redaction;
  const isCurrent = r.date === meta.currentRedaction;
  return {
    meta,
    text: isCurrent ? await current() : await getText(meta.nreg, r.date),
    asOf: date,
    redactionDate: r.date,
    note: `\u0421\u0442\u0430\u043D\u043E\u043C \u043D\u0430 ${date} \u0443 \u0440\u0435\u0454\u0441\u0442\u0440\u0456 \u2014 \u0440\u0435\u0434\u0430\u043A\u0446\u0456\u044F \u0432\u0456\u0434 ${r.date}. \u0427\u0438 \u043D\u0430\u0431\u0440\u0430\u043B\u0430 \u0432\u043E\u043D\u0430 \u043D\u0430 \u0442\u0443 \u0434\u0430\u0442\u0443 \u0447\u0438\u043D\u043D\u043E\u0441\u0442\u0456, \u043F\u0435\u0440\u0435\u0432\u0456\u0440 \u0443 \u043F\u0440\u0438\u043A\u0456\u043D\u0446\u0435\u0432\u0438\u0445 \u043F\u043E\u043B\u043E\u0436\u0435\u043D\u043D\u044F\u0445 \u0430\u043A\u0442\u0430.`
  };
}
function beforeExisted(nreg, title, date, first) {
  return {
    found: false,
    nreg,
    act_title: title,
    as_of: date,
    message: `\u041D\u0430 ${date} \u0446\u044C\u043E\u0433\u043E \u0430\u043A\u0442\u0430 \u0432 \u0440\u0435\u0454\u0441\u0442\u0440\u0456 \u0449\u0435 \u043D\u0435 \u0431\u0443\u043B\u043E: \u043F\u0435\u0440\u0448\u0430 \u0440\u0435\u0434\u0430\u043A\u0446\u0456\u044F \u2014 ${first}. \u0422\u0435\u043A\u0441\u0442\u0443 \u0441\u0442\u0430\u043D\u043E\u043C \u043D\u0430 \u0446\u044E \u0434\u0430\u0442\u0443 \u043D\u0435 \u0456\u0441\u043D\u0443\u0454. \u042F\u043A\u0449\u043E \u0432\u0456\u0434\u043D\u043E\u0441\u0438\u043D\u0438 \u0432\u0438\u043D\u0438\u043A\u043B\u0438 \u0440\u0430\u043D\u0456\u0448\u0435, \u0437\u0430\u0441\u0442\u043E\u0441\u043E\u0432\u043D\u0435 \u043F\u0440\u0430\u0432\u043E \u0442\u0440\u0435\u0431\u0430 \u0448\u0443\u043A\u0430\u0442\u0438 \u0432 \u0430\u043A\u0442\u0456, \u0449\u043E \u0434\u0456\u044F\u0432 \u0442\u043E\u0434\u0456.`
  };
}
tool({
  name: "rada_resolve",
  title: "\u0417\u043D\u0430\u0439\u0442\u0438 \u0430\u043A\u0442 \u0437\u0430 \u043D\u0430\u0437\u0432\u043E\u044E \u0430\u0431\u043E \u0430\u0431\u0440\u0435\u0432\u0456\u0430\u0442\u0443\u0440\u043E\u044E",
  description: "\u041F\u0435\u0440\u0435\u0442\u0432\u043E\u0440\u044E\u0454 \u043D\u0430\u0437\u0432\u0443 \u0447\u0438 \u0430\u0431\u0440\u0435\u0432\u0456\u0430\u0442\u0443\u0440\u0443 \u0430\u043A\u0442\u0430 (\xAB\u041A\u0423\u043F\u0410\u041F\xBB, \xAB\u0426\u041A\xBB, \xAB\u041F\u0440\u043E \u043C\u043E\u0431\u0456\u043B\u0456\u0437\u0430\u0446\u0456\u0439\u043D\u0443 \u043F\u0456\u0434\u0433\u043E\u0442\u043E\u0432\u043A\u0443 \u0442\u0430 \u043C\u043E\u0431\u0456\u043B\u0456\u0437\u0430\u0446\u0456\u044E\xBB) \u043D\u0430 \u0441\u0438\u0441\u0442\u0435\u043C\u043D\u0438\u0439 \u043D\u043E\u043C\u0435\u0440 (nreg) \u0456 \u0432\u0456\u0434\u043A\u0438\u0434\u0430\u0454 \u0430\u0440\u0445\u0456\u0432\u043D\u0456 \xAB\u0434\u0432\u0456\u0439\u043D\u0438\u043A\u0438\xBB, \u044F\u043A\u0456 \u043C\u0430\u044E\u0442\u044C \u0441\u0442\u0430\u043D \xAB\u0427\u0438\u043D\u043D\u0438\u0439\xBB, \u0430\u043B\u0435 \u043C\u0456\u0441\u0442\u044F\u0442\u044C \u0437\u0430\u0441\u0442\u0430\u0440\u0456\u043B\u0456 \u043D\u043E\u0440\u043C\u0438. \u041F\u043E\u0432\u0435\u0440\u0442\u0430\u0454 \u043E\u0431\u0440\u0430\u043D\u0438\u0439 \u0430\u043A\u0442 \u0456 \u0432\u0441\u0456\u0445 \u043A\u0430\u043D\u0434\u0438\u0434\u0430\u0442\u0456\u0432 \u0456\u0437 \u0440\u0435\u043A\u0432\u0456\u0437\u0438\u0442\u0430\u043C\u0438. \u042F\u043A\u0449\u043E \u0440\u0435\u0454\u0441\u0442\u0440 \u043D\u0435 \u0434\u0430\u0432 \u043E\u0434\u043D\u043E\u0437\u043D\u0430\u0447\u043D\u043E\u0457 \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u0456 \u2014 \u043F\u0440\u044F\u043C\u043E \u043F\u0440\u043E \u0446\u0435 \u043A\u0430\u0436\u0435.",
  inputSchema: schema(
    {
      name: text({
        minLength: 2,
        maxLength: 300,
        description: "\u0410\u0431\u0440\u0435\u0432\u0456\u0430\u0442\u0443\u0440\u0430 (\xAB\u041A\u0423\u043F\u0410\u041F\xBB) \u0430\u0431\u043E \u043F\u043E\u0447\u0430\u0442\u043E\u043A \u043E\u0444\u0456\u0446\u0456\u0439\u043D\u043E\u0457 \u043D\u0430\u0437\u0432\u0438 (\xAB\u041F\u0440\u043E \u2026\xBB). \u041E\u043F\u0438\u0441 \u0437\u0430\u043C\u0456\u0441\u0442\u044C \u043D\u0430\u0437\u0432\u0438 \u043D\u0435 \u043F\u0440\u0430\u0446\u044E\u0454."
      })
    },
    ["name"]
  ),
  handler: budgeted("rada_resolve", async ({ name }) => guard(async () => {
    const r = await resolve(name);
    return { ...r, retrieved_at: now(), act_vs_article: RADA_STATUS_NOTE };
  }))
});
tool({
  name: "rada_status",
  title: "\u0427\u0438\u043D\u043D\u0456\u0441\u0442\u044C \u0430\u043A\u0442\u0430, \u043F\u043E\u0442\u043E\u0447\u043D\u0430 \u0456 \u043C\u0430\u0439\u0431\u0443\u0442\u043D\u044F \u0440\u0435\u0434\u0430\u043A\u0446\u0456\u044F",
  description: "\u0421\u0442\u0430\u043D \u0430\u043A\u0442\u0430 \u0437\u0430 \u043E\u0444\u0456\u0446\u0456\u0439\u043D\u043E\u044E \u043A\u0430\u0440\u0442\u043A\u043E\u044E (\u0441\u043B\u043E\u0432\u043E\u043C, \u043D\u0435 \u043A\u043E\u0434\u043E\u043C), \u043F\u043E\u0442\u043E\u0447\u043D\u0430 \u0440\u0435\u0434\u0430\u043A\u0446\u0456\u044F, \u043F\u0456\u0434\u0441\u0442\u0430\u0432\u0430, \u043A\u0456\u043B\u044C\u043A\u0456\u0441\u0442\u044C \u0440\u0435\u0434\u0430\u043A\u0446\u0456\u0439 \u0456 \u041F\u041E\u041F\u0415\u0420\u0415\u0414\u0416\u0415\u041D\u041D\u042F \u043F\u0440\u043E \u0432\u0436\u0435 \u0443\u0445\u0432\u0430\u043B\u0435\u043D\u0456 \u043C\u0430\u0439\u0431\u0443\u0442\u043D\u0456 \u0440\u0435\u0434\u0430\u043A\u0446\u0456\u0457 (\u0437\u043E\u043A\u0440\u0435\u043C\u0430 \u0442\u0456, \u0449\u043E \u043D\u0430\u0431\u0438\u0440\u0430\u044E\u0442\u044C \u0441\u0438\u043B\u0438 \xAB\u043F\u0456\u0437\u043D\u0456\u0448\u0435\xBB, \u0437\u0430 \u043F\u043E\u0434\u0456\u0454\u044E). \u0421\u0442\u0430\u043D \u0430\u043A\u0442\u0430 \u2260 \u0441\u0442\u0430\u043D \u0441\u0442\u0430\u0442\u0442\u0456: \u043F\u0435\u0440\u0435\u0432\u0456\u0440\u044F\u0439 \u043E\u0434\u0438\u043D\u0438\u0446\u044E \u0447\u0435\u0440\u0435\u0437 rada_unit.",
  inputSchema: schema(
    { nreg: NREG("\u0421\u0438\u0441\u0442\u0435\u043C\u043D\u0438\u0439 \u043D\u043E\u043C\u0435\u0440, \u043D\u0430\u043F\u0440. \xAB435-15\xBB, \xAB8073-10\xBB, \xAB254\u043A/96-\u0432\u0440\xBB.") },
    ["nreg"]
  ),
  handler: budgeted("rada_status", async ({ nreg }) => guard(async () => {
    const meta = await getMeta(nreg);
    const card = await getCard(nreg);
    return {
      nreg: meta.nreg,
      title: card.title || meta.nazva,
      official_number: meta.officialNumber,
      status: card.statusText,
      status_code: meta.statusCode,
      is_archive: meta.isArchive,
      archive_warning: meta.isArchive ? "\u2620\uFE0F \u0426\u0435 \u0410\u0420\u0425\u0406\u0412\u041D\u0410 \u0440\u0435\u0434\u0430\u043A\u0446\u0456\u044F \u0430\u043A\u0442\u0430. \u0407\u0457 \u0441\u0442\u0430\u043D \u043C\u043E\u0436\u0435 \u0447\u0438\u0442\u0430\u0442\u0438\u0441\u044C \u044F\u043A \xAB\u0427\u0438\u043D\u043D\u0438\u0439\xBB, \u0430\u043B\u0435 \u043D\u043E\u0440\u043C\u0438 \u0432 \u043D\u0456\u0439 \u0437\u0430\u0441\u0442\u0430\u0440\u0456\u043B\u0456. \u041D\u0435 \u0446\u0438\u0442\u0443\u0439 \u0457\u0457 \u2014 \u0432\u0456\u0437\u044C\u043C\u0438 \u0447\u0438\u043D\u043D\u0438\u0439 \u0430\u043A\u0442." : void 0,
      adopted: meta.adopted,
      current_redaction: meta.currentRedaction,
      basis: meta.basis,
      total_redactions: meta.totalRedactions,
      future_redactions: meta.futureRedactions,
      future_warning: meta.futureRedactions.length > 0 ? "\u26A0\uFE0F \u0404 \u0443\u0445\u0432\u0430\u043B\u0435\u043D\u0456 \u043C\u0430\u0439\u0431\u0443\u0442\u043D\u0456 \u0440\u0435\u0434\u0430\u043A\u0446\u0456\u0457. \u0422\u0435, \u0449\u043E \u0447\u0438\u043D\u043D\u0435 \u0441\u044C\u043E\u0433\u043E\u0434\u043D\u0456, \u0437\u043C\u0456\u043D\u0438\u0442\u044C\u0441\u044F \u2014 \u0441\u043A\u0430\u0436\u0438 \u043F\u0440\u043E \u0446\u0435 \u043A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0443. \u0420\u0435\u0434\u0430\u043A\u0446\u0456\u044F \u0437 \u0434\u0430\u0442\u043E\u044E \xAB\u043D\u0435\u0432\u0438\u0437\u043D\u0430\u0447\u0435\u043D\u0430\xBB \u043D\u0430\u0431\u0438\u0440\u0430\u0454 \u0441\u0438\u043B\u0438 \u0437\u0430 \u043F\u043E\u0434\u0456\u0454\u044E, \u0430 \u043D\u0435 \u0437\u0430 \u043A\u0430\u043B\u0435\u043D\u0434\u0430\u0440\u0435\u043C." : void 0,
      requisites: card.requisites,
      source_url: `https://data.rada.gov.ua/laws/card/${meta.nreg}`,
      retrieved_at: now(),
      note: RADA_STATUS_NOTE
    };
  }))
});
tool({
  name: "rada_unit",
  title: "\u0422\u0435\u043A\u0441\u0442 \u0441\u0442\u0430\u0442\u0442\u0456 \u0430\u0431\u043E \u0456\u043D\u0448\u043E\u0457 \u043E\u0434\u0438\u043D\u0438\u0446\u0456 \u0430\u043A\u0442\u0430",
  description: "\u0414\u043E\u0441\u043B\u0456\u0432\u043D\u0438\u0439 \u0442\u0435\u043A\u0441\u0442 \u043E\u0434\u043D\u0456\u0454\u0457 \u0441\u0442\u0430\u0442\u0442\u0456, \u0440\u043E\u0437\u0434\u0456\u043B\u0443, \u0433\u043B\u0430\u0432\u0438, \u043F\u0456\u0434\u0440\u043E\u0437\u0434\u0456\u043B\u0443 \u0447\u0438 \u043F\u0430\u0440\u0430\u0433\u0440\u0430\u0444\u0430. \u041F\u0440\u0438\u0439\u043C\u0430\u0454 \xAB130\xBB, \xAB\u0441\u0442.130\xBB, \xAB1270\xBB, \xAB111-1\xBB, \xAB\u0447. 2 \u0441\u0442. 284\xBB, \xAB\u043F. 1 \u0447. 2 \u0441\u0442. 284\xBB, \xAB\u0420\u043E\u0437\u0434\u0456\u043B IV\xBB, \xAB\u041F\u0456\u0434\u0440\u043E\u0437\u0434\u0456\u043B 1\xBB, \xAB\u041F\u0440\u0438\u043A\u0456\u043D\u0446\u0435\u0432\u0456 \u0442\u0430 \u043F\u0435\u0440\u0435\u0445\u0456\u0434\u043D\u0456 \u043F\u043E\u043B\u043E\u0436\u0435\u043D\u043D\u044F \u043F. 19\xBB. \u041E\u043A\u0440\u0435\u043C\u043E \u043F\u043E\u0437\u043D\u0430\u0447\u0430\u0454, \u0449\u043E \u0441\u0442\u0430\u0442\u0442\u044E \u0412\u0418\u041A\u041B\u042E\u0427\u0415\u041D\u041E, \u0456 \u044F\u043A\u0438\u043C \u0437\u0430\u043A\u043E\u043D\u043E\u043C. \u0421\u043B\u0443\u0436\u0431\u043E\u0432\u0456 \u043F\u043E\u0437\u043D\u0430\u0447\u043A\u0438 \u043F\u0440\u043E \u0437\u043C\u0456\u043D\u0438 \u0443 {\u0444\u0456\u0433\u0443\u0440\u043D\u0438\u0445 \u0434\u0443\u0436\u043A\u0430\u0445} \u0432\u0456\u0434\u0434\u0430\u044E\u0442\u044C\u0441\u044F \u043E\u043A\u0440\u0435\u043C\u043E \u0432\u0456\u0434 \u0442\u0435\u043A\u0441\u0442\u0443 \u043D\u043E\u0440\u043C\u0438, \u0449\u043E\u0431 \u0432\u043E\u043D\u0438 \u043D\u0435 \u043F\u043E\u0442\u0440\u0430\u043F\u0438\u043B\u0438 \u0432 \u0446\u0438\u0442\u0430\u0442\u0443. \u041F\u0430\u0440\u0430\u043C\u0435\u0442\u0440 date \u0434\u0430\u0454 \u0440\u0435\u0434\u0430\u043A\u0446\u0456\u044E \u0441\u0442\u0430\u043D\u043E\u043C \u043D\u0430 \u0434\u0430\u0442\u0443. \u041F\u043E\u0432\u0435\u0440\u0442\u0430\u0454 \u041C\u0410\u0421\u0418\u0412 occurrences: \u044F\u043A\u0449\u043E ambiguous=true, \u043F\u0456\u0434 \u0446\u0438\u043C \u043D\u043E\u043C\u0435\u0440\u043E\u043C \u0432 \u0430\u043A\u0442\u0456 \u0454 \u043A\u0456\u043B\u044C\u043A\u0430 \u0440\u0456\u0437\u043D\u0438\u0445 \u0441\u0442\u0430\u0442\u0435\u0439 (\u043D\u0430\u0434\u0440\u044F\u0434\u043A\u043E\u0432\u0456 \u043D\u043E\u043C\u0435\u0440\u0438 \u0432 \u0442\u0435\u043A\u0441\u0442\u043E\u0432\u043E\u043C\u0443 \u0435\u043A\u0441\u043F\u043E\u0440\u0442\u0456 \u0434\u0440\u0443\u043A\u0443\u044E\u0442\u044C\u0441\u044F \u044F\u043A \u0437\u0432\u0438\u0447\u0430\u0439\u043D\u0456) \u2014 \u0442\u043E\u0434\u0456 \u043D\u0435 \u0432\u0438\u0431\u0438\u0440\u0430\u0439 \u0441\u0430\u043C, \u043F\u043E\u043A\u0430\u0436\u0438 \u043E\u0431\u0438\u0434\u0432\u0456.",
  inputSchema: schema(
    {
      nreg: NREG("\u0421\u0438\u0441\u0442\u0435\u043C\u043D\u0438\u0439 \u043D\u043E\u043C\u0435\u0440 \u0430\u043A\u0442\u0430, \u043D\u0430\u043F\u0440. \xAB8073-10\xBB."),
      unit: text({ minLength: 1, maxLength: 100, description: "\u041D\u043E\u043C\u0435\u0440 \u0441\u0442\u0430\u0442\u0442\u0456 \u0430\u0431\u043E \u043D\u0430\u0437\u0432\u0430 \u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u043D\u043E\u0457 \u043E\u0434\u0438\u043D\u0438\u0446\u0456." }),
      date: ISO_DATE(
        "YYYY-MM-DD \u2014 \u0442\u0435\u043A\u0441\u0442 \u0443 \u0440\u0435\u0434\u0430\u043A\u0446\u0456\u0457, \u0447\u0438\u043D\u043D\u0456\u0439 \u043D\u0430 \u0446\u044E \u0434\u0430\u0442\u0443. \u041E\u0431\u043E\u0432'\u044F\u0437\u043A\u043E\u0432\u0438\u0439, \u043A\u043E\u043B\u0438 \u043F\u0438\u0442\u0430\u043D\u043D\u044F \u0441\u0442\u043E\u0441\u0443\u0454\u0442\u044C\u0441\u044F \u043C\u0438\u043D\u0443\u043B\u0438\u0445 \u043F\u043E\u0434\u0456\u0439."
      )
    },
    ["nreg", "unit"]
  ),
  handler: budgeted("rada_unit", async ({ nreg, unit, date }) => guard(async () => {
    const t = await textAsOf(nreg, date);
    const { meta } = t;
    if (!t.text) {
      return beforeExisted(meta.nreg, meta.nazva, date, t.firstRedaction);
    }
    const text2 = t.text;
    const index = buildIndex(text2.body, t.asOf ?? kyivToday());
    const u = sliceUnit(index, unit);
    if (!u.found) {
      return {
        found: false,
        nreg: meta.nreg,
        unit,
        message: `\u041E\u0434\u0438\u043D\u0438\u0446\u044E \xAB${unit}\xBB \u0432 \u0430\u043A\u0442\u0456 ${meta.nreg} \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E. \u0426\u0435 \u043E\u0437\u043D\u0430\u0447\u0430\u0454 \xAB\u044F \u043D\u0435 \u0437\u043D\u0430\u0439\u0448\u043E\u0432 \u0437\u0430 \u0446\u0456\u0454\u044E \u0430\u0434\u0440\u0435\u0441\u043E\u044E\xBB, \u0430 \u043D\u0435 \xAB\u0442\u0430\u043A\u043E\u0457 \u043D\u043E\u0440\u043C\u0438 \u043D\u0435 \u0456\u0441\u043D\u0443\u0454\xBB. \u041F\u0443\u043D\u043A\u0442\u0438 \u0430\u0434\u0440\u0435\u0441\u0443\u0439 \u0440\u0430\u0437\u043E\u043C \u0456\u0437 \u0440\u043E\u0437\u0434\u0456\u043B\u043E\u043C: \xAB\u041F\u0440\u0438\u043A\u0456\u043D\u0446\u0435\u0432\u0456 \u0442\u0430 \u043F\u0435\u0440\u0435\u0445\u0456\u0434\u043D\u0456 \u043F\u043E\u043B\u043E\u0436\u0435\u043D\u043D\u044F \u043F. 19\xBB, \xAB\u041F\u0456\u0434\u0440\u043E\u0437\u0434\u0456\u043B 10 \u043F. 2\xBB. \u0421\u043A\u043E\u0440\u0438\u0441\u0442\u0430\u0439\u0441\u044F rada_list_units, \u0449\u043E\u0431 \u043F\u043E\u0431\u0430\u0447\u0438\u0442\u0438 \u0437\u043C\u0456\u0441\u0442 \u0430\u043A\u0442\u0430.`,
        articles_indexed: index.articles.size,
        source_url: text2.sourceUrl,
        retrieved_at: text2.retrievedAt
      };
    }
    const occurrences = u.occurrences.map((o) => ({
      heading: o.heading,
      context: o.context,
      text: o.text,
      excluded: o.excluded,
      excluded_warning: o.excluded ? `\u2620\uFE0F \u0426\u044E \u043E\u0434\u0438\u043D\u0438\u0446\u044E \u0412\u0418\u041A\u041B\u042E\u0427\u0415\u041D\u041E \u0437 \u0430\u043A\u0442\u0430 (${o.excluded.basis}). \u0410\u043A\u0442 \u043C\u043E\u0436\u0435 \u0431\u0443\u0442\u0438 \u0447\u0438\u043D\u043D\u0438\u043C, \u0430\u043B\u0435 \u0446\u0456\u0454\u0457 \u043D\u043E\u0440\u043C\u0438 \u0432\u0436\u0435 \u043D\u0435\u043C\u0430\u0454.` : void 0,
      amendment_markers: o.markers,
      part_note: o.partNote,
      unconstitutional: o.unconstitutional?.map((x) => ({
        text: x.text,
        lost_force_on: x.lostForceOn,
        partial: x.partial,
        in_force: x.inForce,
        marker: x.marker
      })),
      unconstitutional_warning: o.unconstitutional ? `\u2696\uFE0F \u0427\u0430\u0441\u0442\u0438\u043D\u0443 \u0442\u0435\u043A\u0441\u0442\u0443 \u041A\u043E\u043D\u0441\u0442\u0438\u0442\u0443\u0446\u0456\u0439\u043D\u0438\u0439 \u0421\u0443\u0434 \u0432\u0438\u0437\u043D\u0430\u0432 \u043D\u0435\u043A\u043E\u043D\u0441\u0442\u0438\u0442\u0443\u0446\u0456\u0439\u043D\u043E\u044E. \u0422\u0435, \u0449\u043E \u0432\u0436\u0435 \u043D\u0435 \u0434\u0456\u0454, \u0437 text \u043F\u0440\u0438\u0431\u0440\u0430\u043D\u043E; \u0440\u0435\u0448\u0442\u0443 \u043B\u0438\u0448\u0435\u043D\u043E, \u0430\u043B\u0435 \u043F\u0435\u0440\u0435\u0432\u0456\u0440 \u043A\u043E\u0436\u0435\u043D \u043F\u0443\u043D\u043A\u0442 unconstitutional: lost_force_on \u2014 \u0437 \u044F\u043A\u043E\u0457 \u0434\u0430\u0442\u0438 \u043D\u0435 \u0434\u0456\u0454, partial \u2014 \u0440\u0456\u0448\u0435\u043D\u043D\u044F \u0441\u0442\u043E\u0441\u0443\u0454\u0442\u044C\u0441\u044F \u043B\u0438\u0448\u0435 \u043E\u043A\u0440\u0435\u043C\u043E\u0433\u043E \u0430\u0441\u043F\u0435\u043A\u0442\u0443 (\xAB\u0432 \u0442\u0456\u043C, \u0449\u043E\u2026\xBB), in_force: null \u2014 \u0434\u0430\u0442\u0443 \u0437 \u043F\u043E\u0437\u043D\u0430\u0447\u043A\u0438 \u0432\u0438\u0437\u043D\u0430\u0447\u0438\u0442\u0438 \u043D\u0435 \u0432\u0434\u0430\u043B\u043E\u0441\u044F. \u041D\u0435 \u0446\u0438\u0442\u0443\u0439 \u0442\u0430\u043A\u0443 \u043D\u043E\u0440\u043C\u0443 \u044F\u043A \u0447\u0438\u043D\u043D\u0443, \u043D\u0435 \u0437\u0432\u0456\u0440\u0438\u0432\u0448\u0438 \u0434\u0430\u0442\u0443 \u0439 \u043E\u0431\u0441\u044F\u0433.` : void 0,
      char_count: o.charCount,
      truncated_warning: o.truncated ? `\u041E\u0434\u0438\u043D\u0438\u0446\u044F \u0437\u0430\u0432\u0435\u043B\u0438\u043A\u0430: \u043F\u043E\u043A\u0430\u0437\u0430\u043D\u043E \u043F\u0435\u0440\u0448\u0456 ${o.text.length} \u0456\u0437 ${o.charCount} \u0437\u043D\u0430\u043A\u0456\u0432. \u0414\u043B\u044F \u0446\u0438\u0442\u0443\u0432\u0430\u043D\u043D\u044F \u0437\u0432\u0443\u0437\u044C \u0430\u0434\u0440\u0435\u0441\u0443 \u0434\u043E \u043E\u043A\u0440\u0435\u043C\u043E\u0457 \u0441\u0442\u0430\u0442\u0442\u0456 \u0447\u0438 \u0433\u043B\u0430\u0432\u0438 (\u0437\u043C\u0456\u0441\u0442 \u2014 rada_list_units).` : void 0
    }));
    return {
      found: true,
      nreg: meta.nreg,
      act_title: meta.nazva,
      is_archive: meta.isArchive,
      unit: u.unit,
      ambiguous: u.ambiguous,
      ambiguity_warning: !u.ambiguous ? void 0 : u.ambiguityReason === "repeated" ? `\xAB${u.unit}\xBB \u0432 \u0430\u043A\u0442\u0456 ${meta.nreg} \u0442\u0440\u0430\u043F\u043B\u044F\u0454\u0442\u044C\u0441\u044F ${occurrences.length} \u0440\u0430\u0437\u0438 \u2014 \u0443 \u0440\u0456\u0437\u043D\u0438\u0445 \u0447\u0430\u0441\u0442\u0438\u043D\u0430\u0445 (\u0434\u0438\u0432. \u043F\u043E\u043B\u0435 context). \u0423\u0442\u043E\u0447\u043D\u0438, \u044F\u043A\u0443 \u0441\u0430\u043C\u0435 \u043F\u043E\u0442\u0440\u0456\u0431\u043D\u043E, \u0430\u0431\u043E \u0437\u0432\u0443\u0437\u044C \u0430\u0434\u0440\u0435\u0441\u0443 \u0434\u043E \u0433\u043B\u0430\u0432\u0438 \u0447\u0438 \u0441\u0442\u0430\u0442\u0442\u0456.` : u.ambiguityReason === "flattened" ? `\u2620\uFE0F \u041D\u0415\u041E\u0414\u041D\u041E\u0417\u041D\u0410\u0427\u041D\u041E: \u0441\u0442\u0430\u0442\u0442\u0456, \u043D\u0430\u0434\u0440\u0443\u043A\u043E\u0432\u0430\u043D\u043E\u0457 \u044F\u043A \xAB${unit}\xBB, \u0432 \u0430\u043A\u0442\u0456 ${meta.nreg} \u043D\u0435\u043C\u0430\u0454. \u041F\u043E\u043A\u0430\u0437\u0430\u043D\u043E \u0442\u0435, \u0449\u043E \u043D\u0430\u0434\u0440\u0443\u043A\u043E\u0432\u0430\u043D\u043E \u0431\u0435\u0437 \u0434\u0435\u0444\u0456\u0441\u0430. \u0423 \u0442\u0435\u043A\u0441\u0442\u043E\u0432\u043E\u043C\u0443 \u0435\u043A\u0441\u043F\u043E\u0440\u0442\u0456 \u043D\u0430\u0434\u0440\u044F\u0434\u043A\u043E\u0432\u0456 \u043D\u043E\u043C\u0435\u0440\u0438 \u0432\u0442\u0440\u0430\u0447\u0430\u044E\u0442\u044C \u043F\u043E\u0437\u043D\u0430\u0447\u043A\u0443, \u0442\u043E\u043C\u0443 \u0446\u0435 \u043C\u043E\u0436\u0435 \u0431\u0443\u0442\u0438 \u044F\u043A \u0441\u0442. ${unit}, \u0442\u0430\u043A \u0456 \u043E\u043A\u0440\u0435\u043C\u0430 \u0441\u0442\u0430\u0442\u0442\u044F \u0437 \u0442\u0430\u043A\u0438\u043C \u043D\u043E\u043C\u0435\u0440\u043E\u043C. \u041D\u0415 \u0446\u0438\u0442\u0443\u0439, \u043D\u0435 \u043F\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0432\u0448\u0438 \u0437\u0430 \u043A\u0430\u0440\u0442\u043A\u043E\u044E \u0430\u043A\u0442\u0430, \u0449\u043E \u0446\u0435 \u0442\u0430 \u0441\u0430\u043C\u0430 \u043D\u043E\u0440\u043C\u0430.` : `\u2620\uFE0F \u041D\u0415\u041E\u0414\u041D\u041E\u0417\u041D\u0410\u0427\u041D\u041E: \u043F\u0456\u0434 \u043D\u043E\u043C\u0435\u0440\u043E\u043C \xAB${u.unit}\xBB \u0432 \u0430\u043A\u0442\u0456 ${meta.nreg} \u0454 ${occurrences.length} \u0440\u0456\u0437\u043D\u0456 \u043E\u0434\u0438\u043D\u0438\u0446\u0456 \u2014 \u043D\u0430\u0434\u0440\u044F\u0434\u043A\u043E\u0432\u0438\u0439 \u043D\u043E\u043C\u0435\u0440 (\u043D\u0430\u043F\u0440. \u0441\u0442. 48-1) \u0434\u0440\u0443\u043A\u0443\u0454\u0442\u044C\u0441\u044F \u0442\u0430\u043A \u0441\u0430\u043C\u043E, \u044F\u043A \u0437\u0432\u0438\u0447\u0430\u0439\u043D\u0438\u0439 (\u0441\u0442. 481). \u041D\u0415 \u0432\u0438\u0431\u0438\u0440\u0430\u0439 \u0441\u0430\u043C: \u043F\u043E\u043A\u0430\u0436\u0438 \u043A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0443 \u043E\u0431\u0438\u0434\u0432\u0456 (\u043F\u043E\u043B\u0435 context \u2014 \u0440\u0456\u0437\u043D\u0456 \u0433\u043B\u0430\u0432\u0438) \u0456 \u0437\u0430\u043F\u0438\u0442\u0430\u0439, \u044F\u043A\u0430 \u043F\u043E\u0442\u0440\u0456\u0431\u043D\u0430.`,
      occurrences,
      as_of: t.asOf,
      redaction_date: t.redactionDate,
      redaction_note: t.note,
      future_redactions: meta.futureRedactions.length,
      source_url: text2.sourceUrl,
      retrieved_at: text2.retrievedAt,
      from_cache: text2.fromCache
    };
  }))
});
tool({
  name: "rada_list_units",
  title: "\u041F\u0435\u0440\u0435\u043B\u0456\u043A \u043E\u0434\u0438\u043D\u0438\u0446\u044C \u0430\u043A\u0442\u0430 (\u0437\u043C\u0456\u0441\u0442)",
  description: "\u041D\u0430\u0437\u0432\u0438 \u0441\u0442\u0430\u0442\u0435\u0439 \u0456 \u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u043D\u0438\u0445 \u043E\u0434\u0438\u043D\u0438\u0446\u044C \u0430\u043A\u0442\u0430, \u0437 \u0444\u0456\u043B\u044C\u0442\u0440\u043E\u043C. \u041D\u0430\u0439\u0434\u0435\u0448\u0435\u0432\u0448\u0438\u0439 \u0441\u043F\u043E\u0441\u0456\u0431 \u0437\u043D\u0430\u0439\u0442\u0438, \u0443 \u044F\u043A\u0456\u0439 \u0441\u0430\u043C\u0435 \u043E\u0434\u0438\u043D\u0438\u0446\u0456 \u0436\u0438\u0432\u0435 \u043F\u043E\u0442\u0440\u0456\u0431\u043D\u0435 \u043F\u0438\u0442\u0430\u043D\u043D\u044F, \u043A\u043E\u043B\u0438 \u043D\u043E\u043C\u0435\u0440 \u043D\u0435\u0432\u0456\u0434\u043E\u043C\u0438\u0439: \u0432 \u0443\u043A\u0440\u0430\u0457\u043D\u0441\u044C\u043A\u0438\u0445 \u043A\u043E\u0434\u0435\u043A\u0441\u0430\u0445 \u043D\u0430\u0437\u0432\u0430 \u0441\u0442\u0430\u0442\u0442\u0456 \u043C\u0430\u0439\u0436\u0435 \u0437\u0430\u0432\u0436\u0434\u0438 \u043E\u043F\u0438\u0441\u0443\u0454 \u0457\u0457 \u043F\u0440\u0435\u0434\u043C\u0435\u0442. \u0424\u0456\u043B\u044C\u0442\u0440 \xAB\u0432\u0438\u043A\u043B\u044E\u0447\u0435\u043D\u043E\xBB \u043F\u043E\u043A\u0430\u0437\u0443\u0454 \u0432\u0438\u043A\u043B\u044E\u0447\u0435\u043D\u0456 \u0441\u0442\u0430\u0442\u0442\u0456.",
  inputSchema: schema(
    {
      nreg: NREG("\u0421\u0438\u0441\u0442\u0435\u043C\u043D\u0438\u0439 \u043D\u043E\u043C\u0435\u0440 \u0430\u043A\u0442\u0430."),
      filter: text({ maxLength: 200, description: "\u041F\u0456\u0434\u0440\u044F\u0434\u043E\u043A \u0434\u043B\u044F \u0444\u0456\u043B\u044C\u0442\u0440\u0443\u0432\u0430\u043D\u043D\u044F \u043D\u0430\u0437\u0432, \u043D\u0430\u043F\u0440. \xAB\u0441\u043F\u0430\u0434\u0449\u0438\u043D\xBB, \xAB\u0432\u0438\u043A\u043B\u044E\u0447\u0435\u043D\u043E\xBB." }),
      date: ISO_DATE()
    },
    ["nreg"]
  ),
  handler: budgeted("rada_list_units", async ({ nreg, filter, date }) => guard(async () => {
    const t = await textAsOf(nreg, date);
    if (!t.text) {
      return beforeExisted(t.meta.nreg, t.meta.nazva, date, t.firstRedaction);
    }
    const text2 = t.text;
    const index = buildIndex(text2.body);
    const all = listUnits(index, filter);
    const headings = [];
    let size = 0;
    for (const h of all) {
      if (headings.length === 400 || size + h.length > 3e4) break;
      headings.push(h);
      size += h.length + 3;
    }
    const unstructured = index.articles.size === 0 && index.structural.length === 0;
    const struck = unstructured ? strikeDown(text2.body.replace(/\r\n?/g, "\n"), t.asOf ?? kyivToday()) : void 0;
    const full = struck ? splitMarkers(struck.text) : void 0;
    return {
      nreg: t.meta.nreg,
      as_of: t.asOf,
      redaction_date: t.redactionDate,
      redaction_note: t.note,
      filter: filter ?? null,
      total_articles: index.articles.size,
      total_structural: index.structural.length,
      matches: all.length,
      headings,
      truncated: headings.length < all.length,
      truncated_note: headings.length < all.length ? `\u041F\u043E\u043A\u0430\u0437\u0430\u043D\u043E ${headings.length} \u0437 ${all.length}. \u0417\u0432\u0443\u0437\u044C \u0447\u0435\u0440\u0435\u0437 filter (\u0441\u043B\u043E\u0432\u043E \u0437 \u043D\u0430\u0437\u0432\u0438 \u0441\u0442\u0430\u0442\u0442\u0456, \xAB\u0420\u043E\u0437\u0434\u0456\u043B\xBB, \xAB\u0413\u043B\u0430\u0432\u0430\xBB \u0447\u0438 \xAB\u0432\u0438\u043A\u043B\u044E\u0447\u0435\u043D\u043E\xBB).` : void 0,
      ...full ? {
        full_text: full.clean.slice(0, MAX_UNIT_CHARS),
        full_text_truncated: full.clean.length > MAX_UNIT_CHARS,
        ...struck?.items.length ? { unconstitutional: struck.items } : {},
        note: "\u0412 \u0430\u043A\u0442\u0456 \u043D\u0435\u043C\u0430\u0454 \u0441\u0442\u0430\u0442\u0435\u0439 \u0447\u0438 \u0440\u043E\u0437\u0434\u0456\u043B\u0456\u0432 \u2014 \u043B\u0438\u0448\u0435 \u043F\u0440\u043E\u043D\u0443\u043C\u0435\u0440\u043E\u0432\u0430\u043D\u0456 \u043F\u0443\u043D\u043A\u0442\u0438, \u0442\u043E\u0436 \u0442\u0435\u043A\u0441\u0442 \u043D\u0430\u0432\u0435\u0434\u0435\u043D\u043E \u043F\u043E\u0432\u043D\u0456\u0441\u0442\u044E. \u041E\u043A\u0440\u0435\u043C\u0438\u0439 \u043F\u0443\u043D\u043A\u0442: rada_unit \u0437 unit \xAB\u043F. N\xBB."
      } : {},
      source_url: text2.sourceUrl,
      retrieved_at: text2.retrievedAt,
      from_cache: text2.fromCache
    };
  }))
});
tool({
  name: "lpd_search",
  title: "\u041F\u0440\u0430\u0432\u043E\u0432\u0456 \u043F\u043E\u0437\u0438\u0446\u0456\u0457 \u0412\u0435\u0440\u0445\u043E\u0432\u043D\u043E\u0433\u043E \u0421\u0443\u0434\u0443",
  description: "\u041F\u043E\u0448\u0443\u043A \u0443 \u0431\u0430\u0437\u0456 \u043F\u0440\u0430\u0432\u043E\u0432\u0438\u0445 \u043F\u043E\u0437\u0438\u0446\u0456\u0439 \u0412\u0421 (lpd.court.gov.ua). semantic=true \u0432\u043C\u0438\u043A\u0430\u0454 \u0441\u0435\u043C\u0430\u043D\u0442\u0438\u0447\u043D\u0438\u0439 \u043F\u043E\u0448\u0443\u043A \u2014 \u043D\u0430\u0439\u043A\u0440\u0430\u0449\u0438\u0439 \u0432\u0445\u0456\u0434 \u0443 \u0441\u0443\u0434\u043E\u0432\u0443 \u043F\u0440\u0430\u043A\u0442\u0438\u043A\u0443 \u0423\u043A\u0440\u0430\u0457\u043D\u0438. \u041F\u043E\u0440\u043E\u0436\u043D\u0456\u0439 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u043D\u0435 \u043E\u0437\u043D\u0430\u0447\u0430\u0454 \u0432\u0456\u0434\u0441\u0443\u0442\u043D\u043E\u0441\u0442\u0456 \u043F\u0440\u0430\u043A\u0442\u0438\u043A\u0438. \u0426\u0438\u0442\u0443\u0432\u0430\u0442\u0438 \u0442\u0440\u0435\u0431\u0430 \u043F\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0443, \u0434\u043E \u044F\u043A\u043E\u0457 \u043F\u0440\u0438\u0432'\u044F\u0437\u0430\u043D\u0430 \u043F\u043E\u0437\u0438\u0446\u0456\u044F, \u0430 \u043D\u0435 \u0441\u0430\u043C\u0443 \u0431\u0430\u0437\u0443.",
  inputSchema: schema(
    {
      query: text({ minLength: 3, maxLength: 500, description: "\u0417\u0430\u043F\u0438\u0442 \u0443\u043A\u0440\u0430\u0457\u043D\u0441\u044C\u043A\u043E\u044E." }),
      semantic: { type: "boolean", description: "true \u2014 \u0441\u0435\u043C\u0430\u043D\u0442\u0438\u0447\u043D\u0438\u0439 \u043F\u043E\u0448\u0443\u043A (aiEnabled). \u0417\u0430 \u0437\u0430\u043C\u043E\u0432\u0447\u0443\u0432\u0430\u043D\u043D\u044F\u043C false." },
      limit: { type: "integer", minimum: 1, maximum: 50 }
    },
    ["query"]
  ),
  handler: budgeted("lpd_search", async ({ query, semantic, limit }) => guard(async () => {
    const r = await searchPositions(query, semantic ?? false);
    return {
      query,
      semantic: r.semantic,
      returned: Math.min(r.positions.length, limit ?? 10),
      matched: r.positions.length,
      positions: r.positions.slice(0, limit ?? 10),
      note: r.note,
      retrieved_at: now()
    };
  }))
});
tool({
  name: "lpd_position",
  title: "\u041E\u0434\u043D\u0430 \u043F\u0440\u0430\u0432\u043E\u0432\u0430 \u043F\u043E\u0437\u0438\u0446\u0456\u044F \u0412\u0421 \u043F\u043E\u0432\u043D\u0456\u0441\u0442\u044E",
  description: "\u041F\u043E\u0432\u043D\u0438\u0439 \u0442\u0435\u043A\u0441\u0442 \u043F\u0440\u0430\u0432\u043E\u0432\u043E\u0457 \u043F\u043E\u0437\u0438\u0446\u0456\u0457 \u0412\u0421 \u0437\u0430 \u0457\u0457 id, \u0440\u0430\u0437\u043E\u043C \u0456\u0437 \u043F\u0440\u0438\u0432'\u044F\u0437\u0430\u043D\u0438\u043C \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u043E\u043C. \u041F\u0435\u0440\u0435\u0434 \u0432\u0438\u043A\u043E\u0440\u0438\u0441\u0442\u0430\u043D\u043D\u044F\u043C \u043F\u0435\u0440\u0435\u0432\u0456\u0440, \u0447\u0438 \u043D\u0435 \u0431\u0443\u043B\u043E \u0432\u0456\u0434\u0441\u0442\u0443\u043F\u0443 \u0432\u0456\u0434 \u043D\u0435\u0457.",
  inputSchema: schema({ id: ID() }, ["id"]),
  handler: budgeted("lpd_position", async ({ id }) => guard(async () => ({
    id,
    position: await position(id),
    source_url: `${SITE}/legal-position/${id}`,
    retrieved_at: now()
  })))
});
tool({
  name: "lpd_digest_search",
  title: "\u041E\u0433\u043B\u044F\u0434\u0438 (\u0434\u0430\u0439\u0434\u0436\u0435\u0441\u0442\u0438) \u043F\u0440\u0430\u043A\u0442\u0438\u043A\u0438 \u0412\u0421",
  description: "\u041F\u043E\u0448\u0443\u043A \u0432 \u043E\u0444\u0456\u0446\u0456\u0439\u043D\u0438\u0445 \u043E\u0433\u043B\u044F\u0434\u0430\u0445 \u043F\u0440\u0430\u043A\u0442\u0438\u043A\u0438 \u0412\u0421 \u0456\u0437 \u043F\u043E\u0441\u0438\u043B\u0430\u043D\u043D\u044F\u043C \u043D\u0430 PDF \u0456 \u0441\u0442\u043E\u0440\u0456\u043D\u043A\u0443. \u041E\u0433\u043B\u044F\u0434 \u2014 \u0443\u0437\u0430\u0433\u0430\u043B\u044C\u043D\u0435\u043D\u043D\u044F \u0441\u0430\u043C\u043E\u0433\u043E \u0441\u0443\u0434\u0443, \u0430\u043B\u0435 \u041D\u0415 \u0434\u0436\u0435\u0440\u0435\u043B\u043E \u043F\u0440\u0430\u0432\u0430: \u0434\u043B\u044F \u0430\u0440\u0433\u0443\u043C\u0435\u043D\u0442\u0443 \u0446\u0438\u0442\u0443\u0439 \u043F\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0443, \u043D\u0430 \u044F\u043A\u0443 \u043E\u0433\u043B\u044F\u0434 \u043F\u043E\u0441\u0438\u043B\u0430\u0454\u0442\u044C\u0441\u044F.",
  inputSchema: schema({ query: text({ minLength: 3, maxLength: 500 }) }, ["query"]),
  handler: budgeted("lpd_digest_search", async ({ query }) => guard(async () => ({
    query,
    ...await searchDigests(query),
    retrieved_at: now()
  })))
});
tool({
  name: "edrsr_search",
  title: "\u041F\u043E\u0448\u0443\u043A \u0443 \u0440\u0435\u0454\u0441\u0442\u0440\u0456 \u0441\u0443\u0434\u043E\u0432\u0438\u0445 \u0440\u0456\u0448\u0435\u043D\u044C (\u0404\u0414\u0420\u0421\u0420)",
  description: '\u041F\u043E\u0448\u0443\u043A \u0443 \u0404\u0414\u0420\u0421\u0420. \u0417\u0430 \u043D\u043E\u043C\u0435\u0440\u043E\u043C \u0441\u043F\u0440\u0430\u0432\u0438 (\u0404\u0423\u041D) \u043F\u043E\u0432\u0435\u0440\u0442\u0430\u0454 \u0412\u0421\u042E \u0456\u0441\u0442\u043E\u0440\u0456\u044E \u0441\u043F\u0440\u0430\u0432\u0438 \u0447\u0435\u0440\u0435\u0437 \u0443\u0441\u0456 \u0456\u043D\u0441\u0442\u0430\u043D\u0446\u0456\u0457 \u2014 \u0404\u0423\u041D \u043D\u0435\u0437\u043C\u0456\u043D\u043D\u0438\u0439. \u0413\u0440\u0430\u043C\u0430\u0442\u0438\u043A\u0430 \u0437\u0430\u043F\u0438\u0442\u0443: \u043F\u0440\u043E\u0431\u0456\u043B = AND, OR/NOT \u0432\u0435\u043B\u0438\u043A\u0438\u043C\u0438, "\u0444\u0440\u0430\u0437\u0430", word* \u043F\u0440\u0435\u0444\u0456\u043A\u0441 (\u043F\u043E\u0442\u0440\u0456\u0431\u0435\u043D \u0434\u043B\u044F \u0443\u043A\u0440\u0430\u0457\u043D\u0441\u044C\u043A\u043E\u0457 \u043C\u043E\u0440\u0444\u043E\u043B\u043E\u0433\u0456\u0457). \u0421\u0442\u043E\u043F-\u0441\u043B\u043E\u0432\u0430 (\u041E\u0421\u041E\u0411\u0410, \u0410\u0414\u0420\u0415\u0421\u0410, \u0433\u0440\u043D) \u0456\u0433\u043D\u043E\u0440\u0443\u044E\u0442\u044C\u0441\u044F. \u041B\u0456\u043C\u0456\u0442: \u043E\u0434\u0438\u043D \u043F\u043E\u0448\u0443\u043A \u043D\u0430 \u043F\u0438\u0442\u0430\u043D\u043D\u044F. \u041F\u043E\u0440\u043E\u0436\u043D\u0456\u0439 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 = \xAB\u044F \u043D\u0435 \u0437\u043D\u0430\u0439\u0448\u043E\u0432\xBB.',
  inputSchema: schema({
    expression: text({ maxLength: 500, description: "\u0422\u0435\u043A\u0441\u0442\u043E\u0432\u0438\u0439 \u0437\u0430\u043F\u0438\u0442, \u043D\u0430\u043F\u0440. \xAB\u043F\u043E\u043D\u043E\u0432\u043B\u0435\u043D* \u043F\u0440\u043E\u0433\u0443\u043B*\xBB." }),
    case_number: text({
      maxLength: 40,
      description: "\u0404\u0423\u041D, \u043D\u0430\u043F\u0440. \xAB522/2588/23\xBB. 17-\u0446\u0438\u0444\u0440\u043E\u0432\u0438\u0439 \u043D\u043E\u043C\u0435\u0440 \u0404\u0420\u0414\u0420 \u0442\u0435\u0436 \u043C\u043E\u0436\u043D\u0430 \u2014 \u0439\u043E\u0433\u043E \u0448\u0443\u043A\u0430\u0454 \u044F\u043A \u0442\u0435\u043A\u0441\u0442."
    }),
    reg_number: text({ maxLength: 20 }),
    judge: text({ maxLength: 100, description: "\u041F\u0440\u0456\u0437\u0432\u0438\u0449\u0435 \u0441\u0443\u0434\u0434\u0456." }),
    court_code: text({ maxLength: 20 }),
    date_from: COURT_DATE,
    date_to: COURT_DATE
  }),
  handler: budgeted("edrsr_search", async (args) => guard(async () => {
    if (!args.expression && !args.case_number && !args.reg_number && !args.judge) {
      throw new SourceError(
        "\u041F\u043E\u0442\u0440\u0456\u0431\u0435\u043D \u0445\u043E\u0447\u0430 \u0431 \u043E\u0434\u0438\u043D \u0437\u043C\u0456\u0441\u0442\u043E\u0432\u043D\u0438\u0439 \u043A\u0440\u0438\u0442\u0435\u0440\u0456\u0439: expression, case_number, reg_number \u0430\u0431\u043E judge. \u041F\u043E\u0440\u043E\u0436\u043D\u0456\u0439 \u043F\u043E\u0448\u0443\u043A \u0443 \u0404\u0414\u0420\u0421\u0420 \u043D\u0435 \u0440\u043E\u0431\u0438\u0442\u044C\u0441\u044F \u2014 \u0446\u0435 \u043C\u0430\u0441\u043E\u0432\u0430 \u0432\u0438\u0431\u0456\u0440\u043A\u0430.",
        "input"
      );
    }
    const range = courtDateRange(args.date_from, args.date_to);
    const r = await search({
      expression: args.expression,
      caseNumber: args.case_number,
      regNumber: args.reg_number,
      judge: args.judge,
      courtCode: args.court_code,
      ...range
    });
    return {
      ...r,
      count_warning: r.countCapped ? "\u041B\u0456\u0447\u0438\u043B\u044C\u043D\u0438\u043A \u043E\u0431\u0440\u0456\u0437\u0430\u043D\u043E \u043D\u0430 100 000 \u2014 \u043D\u0435 \u043F\u043E\u0434\u0430\u0432\u0430\u0439 \u0439\u043E\u0433\u043E \u044F\u043A \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0443." : void 0,
      anonymisation: ANONYMISATION_NOTE,
      retrieved_at: now()
    };
  }))
});
tool({
  name: "edrsr_document",
  title: "\u0422\u0435\u043A\u0441\u0442 \u0441\u0443\u0434\u043E\u0432\u043E\u0433\u043E \u0440\u0456\u0448\u0435\u043D\u043D\u044F \u0437 \u0404\u0414\u0420\u0421\u0420",
  description: "\u0427\u0438\u0442\u0430\u0454 \u043E\u0434\u0438\u043D \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442 \u0404\u0414\u0420\u0421\u0420. mode \u043E\u0431\u0438\u0440\u0430\u0454 \u042F\u041A\u0423 \u0447\u0430\u0441\u0442\u0438\u043D\u0443, \u0449\u043E\u0431 \u043E\u0434\u043D\u043E\u0433\u043E \u0437\u0430\u043F\u0438\u0442\u0443 \u0432\u0438\u0441\u0442\u0430\u0447\u0438\u043B\u043E: head \u2014 \u043F\u043E\u0447\u0430\u0442\u043E\u043A; operative \u2014 \u0420\u0415\u0417\u041E\u041B\u042E\u0422\u0418\u0412\u041D\u0410 \u0447\u0430\u0441\u0442\u0438\u043D\u0430, \u0442\u043E\u0431\u0442\u043E \u0447\u0438\u043C \u0441\u043F\u0440\u0430\u0432\u0430 \u0437\u0430\u043A\u0456\u043D\u0447\u0438\u043B\u0430\u0441\u044C (\u0432\u043E\u043D\u0430 \u0432 \u0441\u0430\u043C\u043E\u043C\u0443 \u043A\u0456\u043D\u0446\u0456 95-\u0442\u0438\u0441\u044F\u0447\u043D\u043E\u0433\u043E \u0442\u0435\u043A\u0441\u0442\u0443); grep \u2014 \u0437\u0433\u0430\u0434\u043A\u0438 \u0441\u043B\u043E\u0432\u0430 \u0437 \u043A\u043E\u043D\u0442\u0435\u043A\u0441\u0442\u043E\u043C; tail \u2014 \u043A\u0456\u043D\u0435\u0446\u044C. \u041B\u0456\u043C\u0456\u0442: 8 \u0443\u043D\u0456\u043A\u0430\u043B\u044C\u043D\u0438\u0445 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0456\u0432 \u043D\u0430 \u043F\u0438\u0442\u0430\u043D\u043D\u044F; \u0432\u0436\u0435 \u0437\u0430\u0432\u0430\u043D\u0442\u0430\u0436\u0435\u043D\u0456 \u0447\u0438\u0442\u0430\u044E\u0442\u044C\u0441\u044F \u0431\u0435\u0437\u043A\u043E\u0448\u0442\u043E\u0432\u043D\u043E. \u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0438 \u0404\u0414\u0420\u0421\u0420 \u043D\u0435 \u0437\u0431\u0435\u0440\u0456\u0433\u0430\u044E\u0442\u044C\u0441\u044F \u043D\u0430 \u0434\u0438\u0441\u043A.",
  inputSchema: schema(
    {
      id: ID("id \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430 \u0437 edrsr_search."),
      mode: { type: "string", enum: ["head", "operative", "grep", "tail"] },
      needle: text({ maxLength: 200, description: "\u0421\u043B\u043E\u0432\u043E \u0434\u043B\u044F mode=grep." })
    },
    ["id"]
  ),
  handler: budgeted("edrsr_document", async ({ id, mode, needle }) => guard(async () => ({
    ...await document(id, mode ?? "head", needle),
    documents_used: docsFetched().length,
    documents_budget: MAX_DOCS,
    anonymisation: ANONYMISATION_NOTE,
    retrieved_at: now()
  })))
});
serve(
  // One version for the plugin and its server; check-plugin enforces it.
  { name: "ua-legal-sources", version: package_default.version, instructions: INSTRUCTIONS },
  tools,
  (message) => fail(new SourceError(message, "input"))
);
