/**
 * ЛПД ВС — the Supreme Court's legal-positions database and practice digests
 * (lpd.court.gov.ua, API host lpd-api-prod.court.gov.ua).
 *
 * Request details ported from LEXERY's `lpd.py` (Apache-2.0,
 * https://github.com/LEXERY-AI/lexery-ukrainian-law). Verified live 2026-09-20:
 * `POST /search/text {query, aiEnabled}` returned 50 positions for
 * «поновлення на роботі». No authentication. Endpoints that answer 401 are
 * editorial — they are not to be bypassed.
 */
import { request, SourceError } from "./http.ts";
import { stripTags } from "./html.ts";

export const SITE = "https://lpd.court.gov.ua";

/** The API is inconsistent about its envelope — accept every observed shape. */
function items(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    for (const k of ["results", "data", "items", "rows", "legalPositions"]) {
      const v = (payload as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
    }
  }
  return [];
}

async function call(path: string, body?: unknown): Promise<unknown> {
  const res = await request("lpd", { path, json: body });
  if (res.status !== 200) {
    throw new SourceError(
      `ЛПД: HTTP ${res.status} на ${path}. Практику НЕ перевірено — ` +
        `не відповідай з пам'яті.`,
      "http",
    );
  }
  try {
    return JSON.parse(res.body);
  } catch {
    throw new SourceError(`ЛПД: відповідь на ${path} не є JSON.`, "http");
  }
}

export interface Position {
  id: string;
  /**
   * Lexical search only: whether any word of the query occurs in this position.
   * Semantic search matches by meaning, so this is not computed there.
   */
  queryTermsFound?: boolean;
  title: string;
  /** A snippet: search results are for triage; lpd_position has the full text. */
  text: string;
  /** Set when `text` was shortened to SNIPPET_CHARS. */
  truncated?: boolean;
  url: string;
  extra: Record<string, string>;
}

/**
 * Snippet length per search result. Fifty full positions measured ~14k tokens
 * and long ones can pass Claude Code's 25k hard cap on a tool result; 600
 * characters is enough to judge relevance, and bounds a 50-result answer to
 * roughly 17k tokens in the worst case.
 */
export const SNIPPET_CHARS = 600;

/**
 * Stems of the query's words: the first five letters of each word of three or
 * more, which survives Ukrainian inflection («поновлення» / «поновлений» →
 * «понов», «роботі» / «робота» → «робот»).
 */
export function queryStems(query: string): string[] {
  return (query.toLowerCase().match(/[\p{L}]{3,}/gu) ?? []).map((w) => w.slice(0, 5));
}

/** Does any query stem occur in this text? Case-insensitive. */
export function mentionsQuery(text: string, stems: string[]): boolean {
  const t = text.toLowerCase();
  return stems.some((stem) => t.includes(stem));
}

export interface SearchResult {
  positions: Position[];
  semantic: boolean;
  note: string;
}

/**
 * Search legal positions. `semantic: true` sets `aiEnabled`, which is the best
 * machine-readable entry point into Ukrainian court practice.
 */
export async function searchPositions(
  query: string,
  semantic = false,
): Promise<SearchResult> {
  const payload = await call("/search/text", {
    query,
    aiEnabled: semantic,
    comment: null,
  });
  const raw = items(payload);
  const stems = semantic ? [] : queryStems(query);

  const positions: Position[] = raw
    .filter((it) => it && typeof it === "object")
    .map((it) => {
      const id = String(it.id ?? it.legalPositionId ?? "?");
      const extra: Record<string, string> = {};
      for (const k of ["approvedAt", "courtName", "documentDate", "status"]) {
        if (it[k] !== undefined && it[k] !== null) extra[k] = String(it[k]);
      }
      const title = stripTags(it.title ?? it.name);
      const full = stripTags(it.text ?? it.shortText);
      const truncated = full.length > SNIPPET_CHARS;
      return {
        id,
        ...(stems.length ? { queryTermsFound: mentionsQuery(`${title} ${full}`, stems) } : {}),
        title,
        text: truncated ? `${full.slice(0, SNIPPET_CHARS)}…` : full,
        ...(truncated ? { truncated } : {}),
        url: `${SITE}/legal-position/${id}`,
        extra,
      };
    });

  // ☠️ The API never answers «nothing found». Measured: the lexical search for
  // pure gibberish («qwzx») returns ten real Supreme Court positions on unrelated
  // subjects — a different ten each time. Passed through, they read as results
  // and invite citing irrelevant case law. If not one of them contains a word of
  // the query, the search matched nothing, and that is what we report.
  if (stems.length && positions.length && positions.every((p) => !p.queryTermsFound)) {
    return {
      positions: [],
      semantic,
      note:
        "Жодна з позицій, які повернула ЛПД, не містить слів запиту — це не " +
        "результати пошуку, а добірка, яку база віддає, коли нічого не знайшла. " +
        "Спробуй інше формулювання або semantic=true. Це НЕ «практики немає».",
    };
  }

  return {
    positions,
    semantic,
    note:
      positions.length === 0
        ? "0 позицій. Це НЕ «практики немає» — спробуй інше формулювання, " +
          "семантичний пошук (semantic=true), дайджести ВС і ЄДРСР."
        : (semantic
            ? "Семантичний пошук повертає найближче за змістом завжди, навіть " +
              "коли точного збігу немає — перевір, що кожна позиція справді про " +
              "твоє питання. "
            : "") +
          "Це фрагменти для відбору — повний текст позиції дає lpd_position. " +
          "Цитуй ПОСТАНОВУ, до якої прив'язана позиція, а не саму ЛПД. " +
          "Перевір, чи не було відступу від цієї позиції.",
  };
}

export async function position(id: string): Promise<unknown> {
  if (!/^\d+$/.test(id)) {
    throw new SourceError(`ЛПД id має бути числом, отримано «${id}».`, "input");
  }
  return call(`/legal-position/${id}`);
}

export interface DigestHit {
  title: string;
  type: string;
  page: string;
  snippet: string;
  pdfUrl?: string;
}

export interface DigestResult {
  totalMatches: number | null;
  totalDigests: number | null;
  countCapped: boolean;
  hits: DigestHit[];
  note: string;
}

export async function searchDigests(query: string): Promise<DigestResult> {
  const payload = (await call("/digest/search", { query })) as Record<
    string,
    unknown
  >;
  const total =
    typeof payload?.totalMatches === "number" ? payload.totalMatches : null;
  const digests =
    typeof payload?.totalDigests === "number" ? payload.totalDigests : null;

  const hits: DigestHit[] = items(payload).map((r) => ({
    title: stripTags(r.title),
    type: stripTags(r.typeLabel),
    page: stripTags(r.pageLabel),
    snippet: stripTags(r.snippet),
    pdfUrl: typeof r.externalUrl === "string" ? r.externalUrl : undefined,
  }));

  return {
    totalMatches: total,
    totalDigests: digests,
    countCapped: total === 100,
    hits,
    note:
      (total === 100
        ? "Лічильник обрізано на 100 — не подавай це як статистику. "
        : "") +
      "Огляд ВС — офіційне узагальнення самого суду, але НЕ джерело права. " +
      "Для аргументу цитуй постанову, на яку огляд посилається.",
  };
}
