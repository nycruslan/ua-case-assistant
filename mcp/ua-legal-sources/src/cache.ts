/**
 * Disk cache for data.rada content: legislation texts, and the resolver's
 * name→nreg map.
 *
 * ☠️ ЄДРСР documents are NEVER cached. Personal-data leaks in the register are
 * fixed by re-masking the SAME document id (ст. 8 ч. 2-3 ЗУ № 3262-IV), so a
 * cache would keep serving withdrawn personal data after the court withdrew it.
 * Only data.rada content, which carries no personal data and an open licence,
 * is stored here.
 *
 * Caching a 1.8 MB code once is what makes unit-level addressing cheap: after
 * the first fetch, any article, розділ, підрозділ or примітка of that redaction
 * is sliced locally at zero network cost.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT =
  process.env.UA_LEGAL_CACHE_DIR ??
  join(homedir(), ".cache", "ua-legal-sources");

export interface CachedText {
  body: string;
  /** Last-Modified as the server sent it, for a later If-Modified-Since. */
  lastModified?: string;
  fetchedAt: string;
}

function keyPath(key: string): string {
  const h = createHash("sha256").update(key).digest("hex").slice(0, 32);
  return join(ROOT, `${h}.json`);
}

/** `maxAgeMs` treats an older entry as absent. Omit it to accept any age. */
export async function readCache(
  key: string,
  maxAgeMs?: number,
): Promise<CachedText | undefined> {
  try {
    const raw = await readFile(keyPath(key), "utf8");
    const entry = JSON.parse(raw) as CachedText;
    if (maxAgeMs !== undefined) {
      const age = Date.now() - Date.parse(entry.fetchedAt);
      if (!Number.isFinite(age) || age > maxAgeMs) return undefined;
    }
    return entry;
  } catch {
    return undefined;
  }
}

export async function writeCache(key: string, value: CachedText): Promise<void> {
  try {
    await mkdir(ROOT, { recursive: true });
    await writeFile(keyPath(key), JSON.stringify(value), "utf8");
  } catch {
    // A cache miss must never fail a lookup; losing the cache is not an error.
  }
}

/** Small in-process cache for metadata that is cheap to refetch. */
const mem = new Map<string, { at: number; value: unknown }>();

export function memGet<T>(key: string, ttlMs: number): T | undefined {
  const hit = mem.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > ttlMs) {
    mem.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function memSet(key: string, value: unknown): void {
  mem.set(key, { at: Date.now(), value });
}
