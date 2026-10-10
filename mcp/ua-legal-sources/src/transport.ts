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
import { request as httpRequestRaw, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Socket } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

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
  /** Hard deadline for the whole exchange, connect to last byte. */
  timeoutMs: number;
  /** Cap the TLS version. Required for the rada hosts — see the note above. */
  tlsMaxVersion?: "TLSv1.2" | "TLSv1.3";
}

/** Thrown for transport-level failures only; an HTTP status is a result. */
export class TransportError extends Error {
  timedOut: boolean;
  /** For a timeout: did the server answer at all before it stalled? */
  gotResponse: boolean;
  constructor(message: string, timedOut = false, gotResponse = false) {
    super(message);
    this.name = "TransportError";
    this.timedOut = timedOut;
    this.gotResponse = gotResponse;
  }
}

const MAX_REDIRECTS = 3;

function decoderFor(encoding: string | undefined) {
  switch ((encoding ?? "").toLowerCase()) {
    case "gzip":
      return createGunzip();
    case "deflate":
      return createInflate();
    case "br":
      return createBrotliDecompress();
    default:
      return undefined;
  }
}

/**
 * Read and decompress a response body.
 *
 * ☠️ `res.pipe(createGunzip())` does not forward errors: when a server dropped
 * the connection in the middle of a compressed body, the response errored, the
 * decompressor never ended, and the request hung forever — every later request
 * to that host queued behind it until the app restarted. `pipeline` propagates
 * a failure from any stage and destroys the others.
 */
export async function readBody(
  res: Readable & { headers: IncomingMessage["headers"] },
): Promise<string> {
  const chunks: Buffer[] = [];
  const sink = async (source: AsyncIterable<Buffer>) => {
    for await (const chunk of source) chunks.push(chunk);
  };
  const decoder = decoderFor(res.headers["content-encoding"] as string | undefined);
  if (decoder) await pipeline(res, decoder, sink);
  else await pipeline(res, sink);
  return Buffer.concat(chunks).toString("utf8");
}

function flatten(res: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers)) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

/**
 * The proxy to use for `target`, from HTTPS_PROXY / NO_PROXY, if any.
 *
 * Cloud sandboxes reach the internet only through such a proxy; connecting
 * directly there fails with ENOTFOUND.
 */
export function proxyFor(target: URL, env = process.env): URL | undefined {
  const raw = env.HTTPS_PROXY ?? env.https_proxy;
  if (!raw) return undefined;
  const host = target.hostname.toLowerCase();
  const bypass = (env.NO_PROXY ?? env.no_proxy ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^\*?\./, ""))
    .filter(Boolean);
  if (bypass.some((d) => d === "*" || host === d || host.endsWith(`.${d}`))) {
    return undefined;
  }
  return new URL(raw.includes("://") ? raw : `http://${raw}`);
}

/** Open a CONNECT tunnel through `proxy` to `target`. */
function tunnel(proxy: URL, target: URL, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const auth = proxy.username
      ? {
          "Proxy-Authorization":
            "Basic " +
            Buffer.from(
              `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`,
            ).toString("base64"),
        }
      : {};
    const authority = `${target.hostname}:${target.port || 443}`;
    const req = httpRequestRaw({
      host: proxy.hostname,
      port: proxy.port || 80,
      method: "CONNECT",
      path: authority,
      headers: { Host: authority, ...auth },
      agent: false,
    });
    const timer = setTimeout(
      () => req.destroy(new TransportError("timeout", true)),
      timeoutMs,
    );
    req.on("connect", (res, socket) => {
      clearTimeout(timer);
      if (res.statusCode === 200) resolve(socket);
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

async function once(url: string, opts: HttpOptions): Promise<HttpResponse> {
  const target = new URL(url);
  const proxy = proxyFor(target);
  const socket = proxy ? await tunnel(proxy, target, opts.timeoutMs) : undefined;

  return new Promise((resolve, reject) => {
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
        ...(socket ? { socket } : {}),
        // ☠️ Load-bearing for the rada hosts. See the note at the top.
        ...(opts.tlsMaxVersion ? { maxVersion: opts.tlsMaxVersion } : {}),
      },
      (res) => {
        gotResponse = true;
        // A 304 has no body by definition; reading it would hang on some hosts.
        if (res.statusCode === 304) {
          res.resume();
          clearTimeout(timer);
          resolve({ status: 304, headers: flatten(res), body: "" });
          return;
        }
        readBody(res).then(
          (body) => {
            clearTimeout(timer);
            resolve({ status: res.statusCode ?? 0, headers: flatten(res), body });
          },
          (err: Error) => {
            clearTimeout(timer);
            reject(
              timedOut
                ? new TransportError("timeout", true, true)
                : new TransportError(`response stream: ${err.message}`),
            );
          },
        );
      },
    );

    // ☠️ A hard deadline for the whole exchange, not a socket idle timeout: an
    // idle timeout stops counting once the socket closes, which is exactly when
    // a half-received response used to hang. Destroying the request settles
    // every stage, and the flag tells a hang from a refusal — they demand
    // opposite reactions.
    const timer = setTimeout(() => {
      timedOut = true;
      req.destroy(new TransportError("timeout", true, gotResponse));
    }, opts.timeoutMs);

    req.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(
        timedOut
          ? new TransportError("timeout", true, gotResponse)
          : err instanceof TransportError
            ? err
            : new TransportError(err.message),
      );
    });
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
