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
import { isAbsolute, join } from "node:path";

/**
 * Where the disk cache lives: `UA_LEGAL_CACHE_DIR` if set, else the plugin's
 * persistent data directory, else `~/.cache/ua-legal-sources`.
 *
 * Claude Code exports `CLAUDE_PLUGIN_DATA` to a plugin's MCP server, so the
 * plugin's `.mcp.json` needs no `env` — and must not have one: the plugin
 * directory refuses a server config that names any variable but
 * `${CLAUDE_PLUGIN_ROOT}`. ☠️ A value that is not a usable absolute path (an
 * unexpanded `${…}`, a relative path) is skipped: writes there failed
 * silently, and every call fetched a whole code again.
 */
export function cacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  const usable = (dir?: string) => (dir && isAbsolute(dir) && !dir.includes("${") ? dir : undefined);
  const pluginData = usable(env.CLAUDE_PLUGIN_DATA);
  return (
    usable(env.UA_LEGAL_CACHE_DIR) ??
    (pluginData ? join(pluginData, "cache") : join(homedir(), ".cache", "ua-legal-sources"))
  );
}

const ROOT = cacheRoot();

export interface CachedText {
  body: string;
  /** Last-Modified as the server sent it, for a later If-Modified-Since. */
  lastModified?: string;
  fetchedAt: string;
  /** For an act's current text: the redaction it holds, YYYY-MM-DD. */
  redaction?: string;
}

/**
 * The last few entries, in memory. A disk that cannot be written must not mean
 * fetching a 1.8 MB code on every call of the same session.
 */
const recent = new Map<string, CachedText>();
const RECENT_MAX = 4;

function remember(key: string, value: CachedText): void {
  recent.delete(key);
  recent.set(key, value);
  if (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value!);
}

function fresh(entry: CachedText, maxAgeMs?: number): boolean {
  if (maxAgeMs === undefined) return true;
  const age = Date.now() - Date.parse(entry.fetchedAt);
  return Number.isFinite(age) && age <= maxAgeMs;
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
  const mem = recent.get(key);
  if (mem) return fresh(mem, maxAgeMs) ? mem : undefined;
  try {
    const raw = await readFile(keyPath(key), "utf8");
    const entry = JSON.parse(raw) as CachedText;
    // A truncated or foreign file is a cache miss, never a crash downstream.
    if (typeof entry?.body !== "string" || typeof entry?.fetchedAt !== "string") {
      return undefined;
    }
    if (!fresh(entry, maxAgeMs)) return undefined;
    remember(key, entry);
    return entry;
  } catch {
    return undefined;
  }
}

export async function writeCache(key: string, value: CachedText): Promise<void> {
  remember(key, value);
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
