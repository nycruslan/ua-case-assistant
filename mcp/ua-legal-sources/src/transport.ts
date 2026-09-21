/**
 * The one HTTP primitive this server uses, built on `node:https`.
 *
 * ☠️ THE important detail: `tlsMaxVersion`.
 *
 * data.rada.gov.ua and zakon.rada.gov.ua (one host — the first is a CNAME of the
 * second) speak TLS 1.2 ONLY, and they do not negotiate down. Offered TLS 1.3,
 * they drop the connection mid-handshake, which surfaces as ECONNRESET or
 * "Client network socket disconnected before secure TLS connection was
 * established". Node offers 1.3 by default, so a plain request to them fails
 * intermittently for no visible reason, while curl — which lands on 1.2 —
 * succeeds every time. Measured with a bare TLS probe:
 *
 *   data.rada.gov.ua       default=ECONNRESET  maxVersion TLSv1.2=OK
 *   zakon.rada.gov.ua      default=ECONNRESET  maxVersion TLSv1.2=OK
 *   reyestr.court.gov.ua   default=TLSv1.3     (fine as-is)
 *   lpd-api-prod.court...  default=TLSv1.3     (fine as-is)
 *
 * So the cap is applied per host, only where the server requires it — the court
 * hosts keep TLS 1.3.
 *
 * `agent: false` is a separate, smaller point: at one request per five seconds a
 * connection pool has nothing to reuse, and these servers close idle sockets
 * around the same interval, so a pool only adds a chance of handing out a socket
 * the server is already closing.
 *
 * Using stdlib rather than undici keeps the server dependency-free, so it
 * bundles into the plugin as a single file and users never run `npm install`.
 */
import { request as httpsRequest } from "node:https";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { IncomingMessage } from "node:http";

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface HttpOptions {
  method: "GET" | "POST";
  headers: Record<string, string>;
  /** Already-encoded request body. */
  body?: string;
  /** Stop at a 3xx and return it, so the Location header can be read. */
  noRedirect?: boolean;
  timeoutMs: number;
  /** Cap the TLS version. Required for the rada hosts — see the note above. */
  tlsMaxVersion?: "TLSv1.2" | "TLSv1.3";
}

/** Thrown for transport-level failures only; an HTTP status is a result. */
export class TransportError extends Error {
  timedOut: boolean;
  constructor(message: string, timedOut = false) {
    super(message);
    this.name = "TransportError";
    this.timedOut = timedOut;
  }
}

const MAX_REDIRECTS = 3;

function decompress(res: IncomingMessage): NodeJS.ReadableStream {
  switch ((res.headers["content-encoding"] ?? "").toLowerCase()) {
    case "gzip":
      return res.pipe(createGunzip());
    case "deflate":
      return res.pipe(createInflate());
    case "br":
      return res.pipe(createBrotliDecompress());
    default:
      return res;
  }
}

function flatten(res: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers)) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

function once(url: string, opts: HttpOptions): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
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
        timeout: opts.timeoutMs,
        // ☠️ Load-bearing for the rada hosts. See the note at the top.
        ...(opts.tlsMaxVersion ? { maxVersion: opts.tlsMaxVersion } : {}),
      },
      (res) => {
        // A 304 has no body by definition; reading it would hang on some hosts.
        if (res.statusCode === 304) {
          res.resume();
          resolve({ status: 304, headers: flatten(res), body: "" });
          return;
        }
        const chunks: Buffer[] = [];
        const stream = decompress(res);
        stream.on("data", (c: Buffer) => chunks.push(c));
        stream.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: flatten(res),
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        stream.on("error", (err: Error) =>
          reject(new TransportError(`response stream: ${err.message}`)),
        );
      },
    );

    req.on("timeout", () => {
      // `timeout` does not abort on its own; destroy with a marked error so the
      // caller can tell a hang from a refusal — they demand opposite reactions.
      req.destroy(new TransportError("timeout", true));
    });
    req.on("error", (err: Error) =>
      reject(
        err instanceof TransportError
          ? err
          : new TransportError(err.message),
      ),
    );
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

/**
 * Perform one request, following redirects unless `noRedirect` is set.
 *
 * Only same-method GET following is implemented, because nothing here needs
 * more: the single POST endpoint (ЄДРСР search) answers 200 directly.
 */
export async function httpRequest(
  url: string,
  opts: HttpOptions,
): Promise<HttpResponse> {
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
