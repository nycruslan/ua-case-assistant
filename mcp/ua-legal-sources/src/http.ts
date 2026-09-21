/**
 * Per-host request policy for Ukrainian state legal sources.
 *
 * Every rule here was verified live on 2026-09-20 (see docs/research-findings.md).
 * The politeness limits are part of the contract with these sources, not a
 * performance tunable: data.rada publishes them, and ЄДРСР states that its
 * anti-bot exists to stop bulk «викачування». Loosening them is a policy
 * decision for a human, not an optimisation.
 */

import { httpRequest, TransportError } from "./transport.ts";

export type HostKey = "data.rada" | "zakon.rada" | "lpd" | "edrsr";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

interface HostPolicy {
  base: string;
  /** Minimum gap between two requests to this host, ms. */
  minIntervalMs: number;
  /** Extra random jitter on top. data.rada asks for a random 5–7 s pause. */
  jitterMs: number;
  ua: string;
  headers: Record<string, string>;
  /**
   * Cap the TLS version for this host. Set only where the server needs it: the
   * rada hosts are TLS 1.2-only and drop a 1.3 handshake instead of negotiating
   * down. See the note in transport.ts.
   */
  tlsMaxVersion?: "TLSv1.2" | "TLSv1.3";
}

/**
 * ☠️ The User-Agent is load-bearing and differs per host:
 *  - data.rada REQUIRES the literal "OpenData" for anonymous access.
 *  - zakon.rada returns 400 on an empty UA, and 403 on "OpenData" for HTML.
 *  - ЄДРСР must NEVER see the rada "OpenData" UA.
 */
const POLICY: Record<HostKey, HostPolicy> = {
  "data.rada": {
    base: "https://data.rada.gov.ua",
    // Documented: <=60 req/min, but the portal asks for a random 5–7 s pause
    // between requests. We honour the request, not just the hard ceiling.
    minIntervalMs: 5000,
    jitterMs: 2000,
    ua: "OpenData",
    headers: { Accept: "*/*" },
    tlsMaxVersion: "TLSv1.2",
  },
  "zakon.rada": {
    // Used for ONE thing only: the name→nreg resolver, which answers in a 302
    // Location header. No page body is ever fetched or parsed from this host.
    base: "https://zakon.rada.gov.ua",
    minIntervalMs: 1000,
    jitterMs: 200,
    ua: BROWSER_UA,
    headers: {
      Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "Accept-Language": "uk-UA,uk;q=0.9",
    },
    tlsMaxVersion: "TLSv1.2",
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
      Referer: "https://lpd.court.gov.ua/",
    },
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
      Referer: "https://reyestr.court.gov.ua/",
    },
  },
};

const lastRequestAt: Record<string, number> = {};
/** Successful responses per host — lets us tell a cooldown from a header bug. */
const okCount: Record<string, number> = {};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttle(host: HostKey) {
  const p = POLICY[host];
  const gap = p.minIntervalMs + Math.random() * p.jitterMs;
  const since = Date.now() - (lastRequestAt[host] ?? 0);
  if (since < gap) await sleep(gap - since);
}

export type ErrorKind =
  | "input"
  | "unavailable"
  | "http"
  | "cooldown"
  | "headers"
  | "blocked"
  | "budget"
  | "network";

export class SourceError extends Error {
  kind: ErrorKind;
  constructor(message: string, kind: ErrorKind) {
    super(message);
    this.name = "SourceError";
    this.kind = kind;
  }
}

export interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  url: string;
  /** 304 Not Modified — the caller should reuse its cached copy. */
  notModified: boolean;
}

export interface RequestOptions {
  /** Path appended to the host base, already percent-encoded. */
  path: string;
  method?: "GET" | "POST";
  /** application/x-www-form-urlencoded body (ЄДРСР search). */
  form?: Record<string, string>;
  /** JSON body (LPD). */
  json?: unknown;
  /** Send If-Modified-Since so the server can answer 304. */
  ifModifiedSince?: string;
  /** Do not follow redirects — the 302 Location IS the answer. */
  noRedirect?: boolean;
  timeoutMs?: number;
}

/**
 * In-flight tail per host, so requests to one host run strictly one at a time.
 *
 * `throttle` alone cannot guarantee that: two concurrent callers both read the
 * same `lastRequestAt`, sleep the same amount and then fire together. These
 * sources ask for one request at a time, so the queue makes that real instead of
 * relying on every caller happening to await in sequence.
 */
const inFlight: Partial<Record<HostKey, Promise<unknown>>> = {};

export function request(
  host: HostKey,
  opts: RequestOptions,
): Promise<RawResponse> {
  const run = () => attempt(host, opts);
  // `.then(run, run)` so one failure does not poison the rest of the queue.
  const queued = (inFlight[host] ?? Promise.resolve()).then(run, run);
  inFlight[host] = queued.catch(() => {});
  return queued;
}

/**
 * Backoffs between retries of a transient transport failure.
 *
 * data.rada resets connections intermittently even with pooling disabled, and a
 * single retry was measured as not quite enough. Three attempts, spread by the
 * per-host throttle on top of these delays, is the smallest number that held.
 *
 * ONLY "network" failures are retried. An HTTP status is an answer and is
 * returned as-is; a cooldown is NEVER retried, because retrying is precisely
 * what deepens a soft rate limit.
 */
const RETRY_BACKOFF_MS = [2000, 5000];

async function attempt(
  host: HostKey,
  opts: RequestOptions,
): Promise<RawResponse> {
  for (let i = 0; ; i++) {
    try {
      return await requestOnce(host, opts);
    } catch (err) {
      const retryable =
        err instanceof SourceError && err.kind === "network";
      if (!retryable || i >= RETRY_BACKOFF_MS.length) throw err;
      await sleep(RETRY_BACKOFF_MS[i]);
    }
  }
}

async function requestOnce(
  host: HostKey,
  opts: RequestOptions,
): Promise<RawResponse> {
  const p = POLICY[host];
  await throttle(host);

  const headers: Record<string, string> = { "User-Agent": p.ua, ...p.headers };
  let body: string | undefined;
  const method = opts.method ?? (opts.form || opts.json ? "POST" : "GET");

  if (opts.form) {
    body = new URLSearchParams(opts.form).toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    headers["Origin"] = p.base.replace(/\/api\/v1$/, "");
  }
  if (opts.json !== undefined) {
    body = JSON.stringify(opts.json);
    headers["Content-Type"] = "application/json";
  }
  if (body !== undefined) {
    headers["Content-Length"] = String(Buffer.byteLength(body));
  }
  if (opts.ifModifiedSince) headers["If-Modified-Since"] = opts.ifModifiedSince;
  // Ask only for encodings we decompress. ☠️ Never send `identity`: data.rada
  // resets the connection on it.
  headers["Accept-Encoding"] = "gzip, deflate";

  const url = p.base + opts.path;

  try {
    const res = await httpRequest(url, {
      method,
      headers,
      body,
      noRedirect: opts.noRedirect,
      timeoutMs: opts.timeoutMs ?? 90_000,
      tlsMaxVersion: p.tlsMaxVersion,
    });
    lastRequestAt[host] = Date.now();
    okCount[host] = (okCount[host] ?? 0) + 1;
    return {
      status: res.status,
      headers: res.headers,
      body: res.body,
      url,
      notModified: res.status === 304,
    };
  } catch (err) {
    lastRequestAt[host] = Date.now();
    if (err instanceof TransportError && err.timedOut) {
      // ☠️ A hang has two causes, and they demand opposite reactions.
      const seen = okCount[host] ?? 0;
      if (seen > 0) {
        throw new SourceError(
          `${host}: тайм-аут без відповіді після ${seen} успішних запитів. ` +
            `Це м'який rate limit — зачекай перед повторною спробою. ` +
            `Це НЕ означає, що документа не існує.`,
          "cooldown",
        );
      }
      throw new SourceError(
        `${host}: тайм-аут на першому ж запиті, без тіла відповіді. ` +
          `Зазвичай це проблема із заголовками запиту, а не збій сайту.`,
        "headers",
      );
    }
    throw new SourceError(
      `${host}: помилка мережі: ${(err as Error).message}`,
      "network",
    );
  }
}

/**
 * Percent-encode each path segment separately and NEVER touch "/".
 * ☠️ The Constitution's nreg is `254к/96-вр`; encoding the slash as %2F gives 404.
 */
export function encodeNreg(nreg: string): string {
  const segs = nreg.split("/");
  // Defence in depth: callers normalise first, but a `..` segment must never
  // reach a URL — URL resolution would normalise it into a different path.
  if (segs.some((seg) => seg === "" || seg === "." || seg === "..")) {
    throw new SourceError(`Недопустимий nreg: «${nreg}».`, "input");
  }
  return segs.map((seg) => encodeURIComponent(seg)).join("/");
}
