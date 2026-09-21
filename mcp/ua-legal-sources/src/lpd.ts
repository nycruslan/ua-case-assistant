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
  title: string;
  text: string;
  url: string;
  extra: Record<string, string>;
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

  const positions: Position[] = raw
    .filter((it) => it && typeof it === "object")
    .map((it) => {
      const id = String(it.id ?? it.legalPositionId ?? "?");
      const extra: Record<string, string> = {};
      for (const k of ["approvedAt", "courtName", "documentDate", "status"]) {
        if (it[k] !== undefined && it[k] !== null) extra[k] = String(it[k]);
      }
      return {
        id,
        title: stripTags(it.title ?? it.name),
        text: stripTags(it.text ?? it.shortText),
        url: `${SITE}/legal-position/${id}`,
        extra,
      };
    });

  return {
    positions,
    semantic,
    note:
      positions.length === 0
        ? "0 позицій. Це НЕ «практики немає» — спробуй інше формулювання, " +
          "семантичний пошук (semantic=true), дайджести ВС і ЄДРСР."
        : "Цитуй ПОСТАНОВУ, до якої прив'язана позиція, а не саму ЛПД. " +
          "Перевір, чи не було відступу від цієї позиції.",
  };
}

export async function position(id: string): Promise<unknown> {
  if (!/^\d+$/.test(id)) {
    throw new SourceError(`ЛПД id має бути числом, отримано «${id}».`, "http");
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
