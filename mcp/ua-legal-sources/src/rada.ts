/**
 * Ukrainian legislation, via the official open-data API on data.rada.gov.ua.
 *
 * Architecture note (this is a deliberate departure from LEXERY's rada.py):
 * everything except the name→nreg resolver comes from data.rada.gov.ua, whose
 * API the portal documents, rate-limits and sanctions explicitly ("Доступ до
 * API відбувається анонімно без обмежень"). zakon.rada.gov.ua is touched for
 * ONE purpose only — the resolver's 302 Location header — and no page body from
 * that host is ever fetched or parsed.
 *
 * Verified live 2026-09-20:
 *  - /laws/show/<nreg>.json      structured card: is_archive, status, datred,
 *                                eds[] (184 redactions for ЦК), history
 *  - /laws/card/<nreg>           2.7 KB HTML with the authoritative status WORD
 *  - /laws/show/<nreg>.txt       full text, 1.8 MB for ЦК
 *  - /laws/show/<nreg>/ed<YYYYMMDD>.txt   the text as it stood on a date
 *
 * That last one answers a question the spec left open: historical redactions
 * ARE available through open data, so zakon.rada is not needed for them.
 */
import { encodeNreg, request, SourceError } from "./http.ts";
import { memGet, memSet, readCache, writeCache } from "./cache.ts";
import { htmlToText } from "./html.ts";

const META_TTL = 10 * 60 * 1000;
/**
 * A law's name→nreg mapping is stable but not permanent: it changes when a new
 * code is adopted. Cache it for a month rather than forever, so a stale nreg
 * cannot outlive a recodification.
 */
const RESOLVE_TTL = 30 * 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────── metadata (JSON)

export interface RadaMeta {
  nreg: string;
  /** Title, e.g. «Цивільний кодекс України». */
  nazva: string;
  /** Official number, e.g. «435-IV». */
  officialNumber: string;
  /** Numeric status code. The WORD comes from the card — we never guess it. */
  statusCode: number;
  /**
   * ☠️ The archive flag. An archived twin of a code still reports status
   * «Чинний», which is the trap that makes a tool quote a repealed penalty.
   * data.rada exposes it as a structured boolean, so no title-string guessing.
   */
  isArchive: boolean;
  /** Current redaction date, ISO. */
  currentRedaction: string;
  /** Adoption date, ISO. */
  adopted?: string;
  /** Act(s) that produced the current redaction. */
  basis: string[];
  redactions: Redaction[];
  futureRedactions: Redaction[];
  totalRedactions: number;
}

export interface Redaction {
  /** ISO date, or "невизначена" for a year-3000 sentinel. */
  date: string;
  raw: string;
  /** nregs of the amending acts. */
  basis: string[];
  /** true when the date is a year-3000 "відбудеться пізніше" sentinel. */
  conditional: boolean;
}

/** data.rada encodes dates as the integer YYYYMMDD. */
function isoFromInt(n: number | string | undefined): string {
  const s = String(n ?? "");
  if (!/^\d{8}$/.test(s)) return "";
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

// ─────────────────────────────────────────────────────────── input hygiene

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
/** ‐ ‑ ‒ – — ― and the minus sign: all arrive by copy-paste from Word or the web. */
const DASHES = /[\u2010-\u2015\u2212]/g;

/**
 * Canonicalise an nreg as a user or a model will actually supply it.
 *
 * Measured: a trailing space, an en dash (`435–15`, which Word and web pages
 * produce constantly) or a zero-width space each turned a valid nreg into a 404.
 *
 * ☠️ It also refuses path traversal. `encodeURIComponent` leaves `..` intact and
 * URL resolution then normalises it away, so `../../laws/main/r` was requested as
 * `/laws/main/r.json` — an arbitrary path on the state server, cached under the
 * user's key. Segments of `.`/`..`, empty segments, whitespace, and URL syntax
 * characters are rejected outright.
 */
export function normalizeNreg(raw: string): string {
  const n = raw.replace(ZERO_WIDTH, "").replace(DASHES, "-").trim();
  const bad =
    n.length === 0 ||
    n.length > 64 ||
    /[\s?#%\\\u0000-\u001f]/.test(n) ||
    n.split("/").some((seg) => seg === "" || seg === "." || seg === "..");
  if (bad) {
    throw new SourceError(
      `«${raw}» не схожий на системний номер акта (nreg), напр. «435-15» або ` +
        `«254к/96-вр». Номер можна отримати через rada_resolve.`,
      "input",
    );
  }
  return n;
}

/** True only for a date that exists in the calendar: 2025-02-30 is false. */
export function isRealDate(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

export type AsOf =
  | { kind: "before"; firstRedaction: string }
  | { kind: "in-force"; redaction: Redaction }
  | { kind: "future" }
  /** The registry keeps no redaction history for this act. */
  | { kind: "no-history" };

/**
 * Which redaction was in force on `asOf`.
 *
 * ☠️ data.rada's `/ed<date>` never refuses a date. Asked for ЦК as of 1990 —
 * thirteen years before it was adopted — it returns HTTP 200 with TODAY's text,
 * byte for byte. Taking that at face value presented the current Civil Code as
 * «редакція станом на 1990-01-01»: a confident, false statement about the law.
 * So the act's own redaction history decides, before anything is fetched.
 */
export function redactionAsOf(
  meta: RadaMeta,
  asOf: string,
  todayIso: string,
): AsOf {
  if (asOf > todayIso) return { kind: "future" };
  // No history is not "did not exist": only the adoption date can say that.
  if (meta.redactions.length === 0) {
    if (meta.adopted && asOf < meta.adopted) {
      return { kind: "before", firstRedaction: meta.adopted };
    }
    return { kind: "no-history" };
  }
  let inForce: Redaction | undefined;
  for (const r of meta.redactions) if (r.date <= asOf) inForce = r;
  if (!inForce) {
    return { kind: "before", firstRedaction: meta.redactions[0].date };
  }
  return { kind: "in-force", redaction: inForce };
}

/**
 * `history` is a pipe-separated list of `YYYYMMDD:podid:basis1,basis2`.
 *
 * ☠️ A date in the year 3000 does not mean "the year 3000". It is how the
 * registry records an adopted amendment whose entry into force depends on an
 * event rather than a date ("відбудеться пізніше"). Reporting it as a date would
 * be wrong; ignoring it would hide a pending change from the advocate.
 *
 * It is NOT a single value: the registry walks the day to distinguish several
 * pending event-conditional redactions. Measured — КУпАП carries 30000101,
 * 30000102 AND 30000103, while ЦК carries only 30000101. Matching the exact
 * string `30000101` reported the other two as literal dates «3000-01-02» and
 * «3000-01-03». So the whole year is the sentinel.
 */
export function parseHistory(history: string): Redaction[] {
  const out: Redaction[] = [];
  for (const chunk of (history || "").split("|")) {
    if (!chunk.trim()) continue;
    const [date, , basis = ""] = chunk.split(":");
    if (!/^\d{8}$/.test(date)) continue;
    const conditional = date.startsWith("3000");
    out.push({
      date: conditional ? "невизначена" : isoFromInt(date),
      raw: date,
      basis: basis.split(",").map((b) => b.trim()).filter(Boolean),
      conditional,
    });
  }
  return out;
}

export function splitFuture(
  reds: Redaction[],
  todayIso: string,
): { past: Redaction[]; future: Redaction[] } {
  const past: Redaction[] = [];
  const future: Redaction[] = [];
  for (const r of reds) {
    if (r.conditional || r.date > todayIso) future.push(r);
    else past.push(r);
  }
  return { past, future };
}

interface RawMeta {
  nreg?: string;
  nazva?: string;
  n_vlas?: string;
  status?: number;
  is_archive?: number;
  datred?: number;
  pridat?: number;
  pidstava?: string;
  edcnt?: number;
  history?: string;
}

export async function getMeta(nreg: string): Promise<RadaMeta> {
  nreg = normalizeNreg(nreg);
  const key = `meta:${nreg}`;
  const hit = memGet<RadaMeta>(key, META_TTL);
  if (hit) return hit;

  const res = await request("data.rada", {
    path: `/laws/show/${encodeNreg(nreg)}.json`,
  });
  if (res.status !== 200) {
    throw new SourceError(
      `data.rada: HTTP ${res.status} для картки ${nreg}. Норму НЕ перевірено — ` +
        `не відповідай з пам'яті.`,
      "http",
    );
  }
  let raw: RawMeta;
  try {
    raw = JSON.parse(res.body) as RawMeta;
  } catch {
    throw new SourceError(
      `data.rada: відповідь для ${nreg} не є JSON (${res.body.length} байт).`,
      "http",
    );
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const all = parseHistory(raw.history ?? "");
  const { past, future } = splitFuture(all, todayIso);

  const meta: RadaMeta = {
    nreg: raw.nreg ?? nreg,
    nazva: raw.nazva ?? "",
    officialNumber: raw.n_vlas ?? "",
    statusCode: raw.status ?? -1,
    isArchive: raw.is_archive === 1,
    currentRedaction: isoFromInt(raw.datred),
    adopted: isoFromInt(raw.pridat) || undefined,
    basis: (raw.pidstava ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    redactions: past,
    futureRedactions: future,
    totalRedactions: raw.edcnt ?? all.length,
  };
  memSet(key, meta);
  return meta;
}

// ───────────────────────────────────────────────────────────── card (status)

export interface RadaCard {
  nreg: string;
  title: string;
  /** The authoritative status word, e.g. «Чинний», «Втратив чинність». */
  statusText: string;
  issuer: string;
  /** e.g. «Кодекс України, Закон, Кодекс від 16.01.2003 № 435-IV» */
  requisites: string;
}

export function parseCard(html: string, nreg: string): RadaCard {
  const t = htmlToText(html);
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  // The card's shape, verified on 435-15:
  //   0  «Верховна Рада України; Кодекс України, Закон, Кодекс від … № 435-IV»
  //   1  «Цивільний кодекс України»          <- title
  //   2  «Стан: Чинний»                      <- authoritative status word
  //   3  «Ідентифікатор: 435-15»
  const statusIdx = lines.findIndex((l) => /^Стан:/i.test(l));
  const statusText =
    statusIdx >= 0 ? lines[statusIdx].replace(/^Стан:\s*/i, "").trim() : "";
  const requisites = lines[0] ?? "";
  const issuer = requisites.split(";")[0]?.trim() ?? "";
  // The title is the line immediately above «Стан:», not a fixed index: the
  // header block gains and loses lines between document kinds.
  const title = statusIdx > 0 ? (lines[statusIdx - 1] ?? "") : (lines[1] ?? "");
  return { nreg, title, statusText, issuer, requisites };
}

export async function getCard(nreg: string): Promise<RadaCard> {
  nreg = normalizeNreg(nreg);
  const key = `card:${nreg}`;
  const hit = memGet<RadaCard>(key, META_TTL);
  if (hit) return hit;
  const res = await request("data.rada", {
    path: `/laws/card/${encodeNreg(nreg)}`,
  });
  if (res.status !== 200) {
    throw new SourceError(
      `data.rada: HTTP ${res.status} для картки ${nreg}.`,
      "http",
    );
  }
  const card = parseCard(res.body, nreg);
  memSet(key, card);
  return card;
}

// ───────────────────────────────────────────────────────────── full text

export interface LawText {
  body: string;
  nreg: string;
  sourceUrl: string;
  retrievedAt: string;
  fromCache: boolean;
}

/**
 * Fetch (and cache) the plain text of an act.
 *
 * `edDate` selects a historical redaction: `/laws/show/<nreg>/ed<YYYYMMDD>.txt`.
 * Verified live: ЦК current text is 1 791 233 bytes, and ed20250101 is
 * 1 717 330 bytes — genuinely different documents, not a silent fallback.
 */
export async function getText(nreg: string, edDate?: string): Promise<LawText> {
  nreg = normalizeNreg(nreg);
  const ed = edDate ? edDate.replace(/-/g, "") : "";
  if (ed && !/^\d{8}$/.test(ed)) {
    throw new SourceError(`Дата редакції має бути YYYY-MM-DD, отримано «${edDate}».`, "input");
  }
  const path = ed
    ? `/laws/show/${encodeNreg(nreg)}/ed${ed}.txt`
    : `/laws/show/${encodeNreg(nreg)}.txt`;
  const cacheKey = `text:${nreg}:${ed || "current"}`;
  const cached = await readCache(cacheKey);

  const res = await request("data.rada", {
    path,
    ifModifiedSince: cached?.lastModified,
  });

  const result = (body: string, retrievedAt: string, fromCache: boolean) => ({
    body,
    nreg,
    sourceUrl: `https://data.rada.gov.ua${path}`,
    retrievedAt,
    fromCache,
  });

  // 304, or any error while a copy is on disk: serve the copy rather than fail.
  if (cached && (res.notModified || res.status !== 200)) {
    return result(cached.body, cached.fetchedAt, true);
  }
  if (res.status !== 200) {
    throw new SourceError(
      `data.rada: HTTP ${res.status} для тексту ${nreg}` +
        (ed ? ` (редакція ${isoFromInt(ed)})` : "") +
        `. Норму НЕ перевірено.`,
      "http",
    );
  }

  const fetchedAt = new Date().toISOString();
  await writeCache(cacheKey, {
    body: res.body,
    lastModified: res.headers["last-modified"],
    fetchedAt,
  });
  return result(res.body, fetchedAt, false);
}

// ───────────────────────────────────────────────────────────── unit slicing

const ARTICLE = /^Стаття\s+(\d+(?:-\d+)?)\s*\.?/;
/**
 * ☠️ Do NOT use `\b` here. JavaScript's `\b` is defined against `\w`, which is
 * ASCII-only, so «Розділ I» has no word boundary after the Cyrillic «л» and a
 * `\b` anchor silently matches nothing. That failure mode is invisible: unit
 * addressing still works for articles, so the bug only shows up as structural
 * units being unreachable and as slices bleeding past a розділ heading.
 */
const STRUCTURAL = /^(Книга|Розділ|Глава|Підрозділ|Параграф)(?=[\s:.]|$)/iu;

/**
 * Nesting depth of a heading. A unit runs until the next heading at the SAME OR
 * HIGHER level, so a Глава includes its articles and a Розділ its Глави.
 *
 * ☠️ Ending a unit at the first heading of ANY kind made every structural unit
 * useless: «Книга 5» of ЦК — a whole book — came back as 480 characters, its own
 * title and nothing else.
 */
const LEVEL: Record<string, number> = {
  книга: 1,
  розділ: 2,
  підрозділ: 3,
  глава: 4,
  параграф: 5,
};
const ARTICLE_LEVEL = 6;

/** Dashes differ between sources and users; compare on plain hyphens only. */
function plainDashes(s: string): string {
  return s.replace(ZERO_WIDTH, "").replace(DASHES, "-");
}

function levelOf(line: string): number | undefined {
  const l = plainDashes(line);
  if (ARTICLE.test(l)) return ARTICLE_LEVEL;
  const m = STRUCTURAL.exec(l);
  return m ? LEVEL[m[1].toLowerCase()] : undefined;
}

/**
 * Most characters of one unit returned in a single answer.
 *
 * Claude Code caps a tool result at 25 000 tokens and warns at 10 000, and
 * Cyrillic runs at roughly 2.5 characters per token. A whole Книга is hundreds of
 * thousands of characters; this keeps one unit near 8 000 tokens and says it
 * was cut, rather than letting the client truncate it silently.
 */
export const MAX_UNIT_CHARS = 20_000;
const MAX_MARKERS = 40;

/**
 * Every apostrophe a user may type for the one in «п'ята»: right single quote,
 * modifier letter apostrophe (the Ukrainian one), left single quote, backtick,
 * prime. Built from code points so no look-alike character sits in the source.
 */
const APOSTROPHES = new RegExp(
  `[${[0x2019, 0x02bc, 0x2018, 0x60, 0x2032].map((c) => String.fromCharCode(c)).join("")}]`,
  "g",
);

/** ЦК names its books in words: «КНИГА П'ЯТА», never «Книга 5». */
const BOOK_ORDINALS = [
  "перша", "друга", "третя", "четверта", "п'ята",
  "шоста", "сьома", "восьма", "дев'ята", "десята",
];

function toRoman(n: number): string {
  const table: [number, string][] = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
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

/** Compare structural headings the way a reader would, not byte for byte. */
function normHeading(s: string): string {
  return plainDashes(s)
    .replace(APOSTROPHES, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Other spellings of the same structural address. A lawyer writes «Книга 5» or
 * «Розділ 1»; ЦК prints «КНИГА П'ЯТА» and «Розділ I». Only used as a fallback,
 * so it can never shadow a heading that is written the way it was asked for.
 */
function headingVariants(spec: string): string[] {
  const m = /^(книга|розділ)\s+(\d{1,2})$/.exec(spec);
  if (!m) return [];
  const n = Number(m[2]);
  if (m[1] === "книга") return BOOK_ORDINALS[n - 1] ? [`книга ${BOOK_ORDINALS[n - 1]}`] : [];
  return n > 0 ? [`розділ ${toRoman(n)}`] : [];
}

export interface UnitIndex {
  /**
   * Article number → EVERY line it appears on.
   *
   * ☠️ Not the first line — every one. The plain-text export renders
   * superscript article numbers as plain digits, so ст. 48¹ and ст. 481 are
   * both printed «Стаття 481.» and the superscript is unrecoverable from the
   * text. Measured on ЦК: 4 numbers collide this way (481, 96¹/961, 99¹/991,
   * 105¹/1051), each pair being two entirely unrelated norms. Keeping only the
   * first occurrence made `rada_unit 481` silently return ст. 48¹ — a confident
   * citation of the wrong article, which is the single worst thing this server
   * could do. Collisions are reported, never resolved by guessing.
   */
  articles: Map<string, number[]>;
  structural: { label: string; line: number }[];
  /**
   * Normalised article number → its exclusion marker.
   *
   * An excluded article keeps no heading, only the marker, so without this an
   * excluded article is unfindable and `rada_unit` would answer "not found"
   * where the correct answer is "excluded by Law N".
   */
  excluded: Map<string, string>;
  lines: string[];
}

export function buildIndex(text: string): UnitIndex {
  // ☠️ data.rada serves CRLF. Splitting on "\n" alone leaves a trailing \r on
  // every line, which then rides into a norm quoted in a court filing — and it
  // also breaks an exact structural match, since «Глава 4\r» is not «Глава 4».
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const articles = new Map<string, number[]>();
  const structural: { label: string; line: number }[] = [];
  const excluded = new Map<string, string>();
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
    if (STRUCTURAL.test(l)) structural.push({ label: raw.trim(), line: i });
  });
  return { articles, structural, excluded, lines };
}

export interface UnitOccurrence {
  heading: string;
  /** Text with the registry's {…} amendment markers removed. */
  text: string;
  /** Those markers, kept separately: provenance, not the norm itself. */
  markers: string[];
  /** Set when this article has been excluded from the act. */
  excluded?: { marker: string; basis: string };
  charCount: number;
  /** Nearest enclosing Книга/Розділ/Глава — what tells two collisions apart. */
  context: string;
  /** Set when `text` was cut at MAX_UNIT_CHARS; `charCount` is the full size. */
  truncated?: boolean;
}

export interface UnitResult {
  found: boolean;
  unit: string;
  /** Every place this address matches. One entry in the normal case. */
  occurrences: UnitOccurrence[];
  /** True when this address cannot be pinned to exactly one unit. */
  ambiguous: boolean;
  /**
   * Why it is ambiguous:
   *  - "collision": one printed number, several distinct articles in the act.
   *  - "flattened": a hyphenated request («50-1») matched only the flattened
   *    printed form («501»), which is lossy — it may be either article.
   *  - "repeated": a structural heading that legitimately recurs — ЦК has a
   *    «Розділ I» in three different books.
   */
  ambiguityReason?: "collision" | "flattened" | "repeated";
}

/**
 * ☠️ Curly braces in the registry's text are amendment provenance, not the
 * norm: `{Частину другу статті 130 змінено згідно із Законом № 3684-IX}`.
 * They can span several lines, so a line-based filter leaks their tail into a
 * quotation. We track brace depth instead.
 */
export function splitMarkers(text: string): { clean: string; markers: string[] } {
  const markers: string[] = [];
  let clean = "";
  let depth = 0;
  let current = "";
  for (const ch of text) {
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
    markers,
  };
}

/**
 * A whole-article exclusion marker, capturing the article number it names.
 *
 * ☠️ Two measured traps, both in ЦК:
 *  - `[СC]` is not a typo. 11 of 179 markers spell «Cтаттю» with a LATIN C
 *    instead of Cyrillic С. A Cyrillic-only pattern misses them, and an excluded
 *    article then reads as live, with its repealed text.
 *  - The number must be captured and compared. An excluded article keeps no
 *    heading of its own, only this marker, so the marker for ст. 50¹ lands
 *    inside the slice of ст. 50. Matching without comparing numbers reported
 *    6 live articles in ЦК as repealed.
 *
 * Partial exclusions («Частину четверту статті 32 виключено», 50 of them in ЦК)
 * are excluded by the `\{\s*` anchor: they do not start with «Статтю».
 */
const EXCLUDED =
  /\{\s*[СC]тат(?:тю|ті)\s+([^\s}]+?)\.?\s+виключено[^}]*?\}/i;
const EXCL_BASIS = /(Закон[^}]*?№\s*[^\s}]+(?:\s+від\s+[\d.]+)?)/i;

/** Normalise an article number for comparison: «501.» and «50-1» → «501». */
function normNum(n: string): string {
  return n.replace(/[.\s]/g, "").replace(/[-‑]/g, "");
}

/**
 * Slice one unit out of an act's text.
 *
 * `unit` accepts an article number ("130", "ст.130", "st130", "111-1") or a
 * structural heading prefix ("Розділ IV", "Підрозділ 1", "Глава 5").
 */
export function sliceUnit(index: UnitIndex, unit: string): UnitResult {
  const spec = plainDashes(unit).trim();
  const artMatch = /^(?:ст\.?|стаття|st)?\s*(\d+(?:-\d+)?)$/i.exec(spec);

  let starts: number[] = [];
  let label = spec;

  if (artMatch) {
    const num = artMatch[1];
    label = `Стаття ${num}`;
    starts = index.articles.get(num) ?? [];

    // A hyphenated request («50-1») is printed without the hyphen, because the
    // export flattens superscripts. Try that form rather than reporting a norm
    // that exists as missing — but remember that the fallback is lossy.
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
        ambiguityReason:
          starts.length > 1 ? "collision" : flattened ? "flattened" : undefined,
      };
    }

    // No heading anywhere, but an exclusion marker names it: the article exists
    // and has been excluded. That is the answer, not "not found".
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
            context: "",
          },
        ],
      };
    }
    return { found: false, unit: spec, occurrences: [], ambiguous: false };
  }

  // ☠️ Exact match first. Plain prefix matching made «Глава 4» also match
  // «Глава 41», reporting a false ambiguity between unrelated chapters.
  const needle = normHeading(spec);
  const byHeading = (wanted: string[]) =>
    index.structural.filter((s) => wanted.includes(normHeading(s.label)));
  let pool = byHeading([needle]);
  if (pool.length === 0) pool = byHeading(headingVariants(needle));
  if (pool.length === 0) {
    pool = index.structural.filter((s) => normHeading(s.label).startsWith(needle));
  }
  starts = pool.map((s) => s.line);
  if (pool[0]) label = pool[0].label;

  if (starts.length === 0) {
    return { found: false, unit: spec, occurrences: [], ambiguous: false };
  }
  return {
    found: true,
    unit: label,
    occurrences: starts.map((s) => extractAt(index, s, undefined, starts.length)),
    ambiguous: starts.length > 1,
    ambiguityReason: starts.length > 1 ? "repeated" : undefined,
  };
}

function basisOf(marker: string): string {
  const m = EXCL_BASIS.exec(marker);
  return m ? m[1].trim() : "реквізити не розпізнано";
}

/**
 * Slice the unit that starts at `start` and describe where it sits.
 *
 * `articleNum`, when given, is compared against any exclusion marker found in
 * the slice: a marker naming a different article must not mark this one as
 * excluded.
 */
function extractAt(
  index: UnitIndex,
  start: number,
  articleNum?: string,
  /** How many occurrences share one answer — they split the size budget. */
  sharing = 1,
): UnitOccurrence {
  const { lines } = index;
  const own = levelOf(lines[start]) ?? ARTICLE_LEVEL;
  let end = lines.length;
  for (let j = start + 1; j < lines.length; j++) {
    const lvl = levelOf(lines[j]);
    if (lvl !== undefined && lvl <= own) {
      end = j;
      break;
    }
  }
  const rawText = lines.slice(start, end).join("\n").trim();
  const split = splitMarkers(rawText);
  // ☠️ The budget is per ANSWER, not per occurrence: three «Розділ I» capped
  // separately still summed to ~26k tokens, over Claude Code's hard limit.
  const budget = Math.floor(MAX_UNIT_CHARS / sharing);
  const truncated = split.clean.length > budget;
  const clean = truncated ? split.clean.slice(0, budget) : split.clean;
  const markers = split.markers.slice(0, Math.max(5, Math.floor(MAX_MARKERS / sharing)));

  // Only a marker that names THIS article excludes it. See EXCLUDED.
  const exclMatch = EXCLUDED.exec(rawText);
  let excluded: UnitOccurrence["excluded"];
  if (
    exclMatch &&
    articleNum !== undefined &&
    normNum(exclMatch[1]) === normNum(articleNum)
  ) {
    excluded = { marker: exclMatch[0], basis: basisOf(exclMatch[0]) };
  }

  // Nearest structural heading above this line.
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
    excluded,
    charCount: rawText.length,
    context,
    ...(truncated ? { truncated } : {}),
  };
}

/** Headings only — the cheap way to find which unit holds a topic. */
export function listUnits(index: UnitIndex, filter?: string): string[] {
  const f = filter?.trim().toLowerCase();
  const keep = (label: string) => !f || label.toLowerCase().includes(f);
  const out = index.structural.map((s) => s.label).filter(keep);
  for (const lines of index.articles.values()) {
    for (const line of lines) {
      const label = index.lines[line].trim();
      if (keep(label)) out.push(label);
    }
  }
  return out;
}

// ───────────────────────────────────────────────────────────── resolver

export interface Candidate {
  nreg: string;
  title: string;
  statusText: string;
  /**
   * null means "could not be determined", NOT "not archived".
   *
   * ☠️ Fail-safe matters here. An archived twin of a code reports status
   * «Чинний» and differs only by this flag, so defaulting an unverified
   * candidate to false would let a stale penalty be chosen silently — the exact
   * error this flag exists to prevent. Unverified candidates are therefore never
   * auto-selected.
   */
  isArchive: boolean | null;
  currentRedaction: string;
  officialNumber: string;
  verified: boolean;
}

export interface ResolveResult {
  query: string;
  /** null when the registry gave an ambiguous answer instead of a 302. */
  chosen: Candidate | null;
  candidates: Candidate[];
  ambiguous: boolean;
  note: string;
}

/**
 * name → nreg, via the ONE zakon.rada endpoint this server uses.
 *
 * The answer is the 302 `Location` header, so no page content is fetched.
 * No 302 means the registry could not disambiguate; the HTML list it would
 * return instead is sorted by DATE, not relevance, so the act you want may be
 * absent from it entirely. We report that honestly rather than guessing.
 */
/**
 * A cached resolver entry, or undefined if it is not a list of nregs.
 *
 * ☠️ An unguarded `JSON.parse` here turned one corrupted cache file into a
 * resolver that failed on every call for a month (the cache TTL).
 */
export function parseNregList(body: string): string[] | undefined {
  try {
    const v: unknown = JSON.parse(body);
    return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string")
      ? v
      : undefined;
  } catch {
    return undefined;
  }
}

export async function resolveNreg(name: string): Promise<string[]> {
  const cacheKey = `resolve:${name.toLowerCase()}`;
  const hit = memGet<string[]>(cacheKey, RESOLVE_TTL);
  if (hit) return hit;
  const disk = await readCache(cacheKey, RESOLVE_TTL);
  const cached = disk && parseNregList(disk.body);
  if (cached) {
    memSet(cacheKey, cached);
    return cached;
  }

  const res = await request("zakon.rada", {
    path: `/laws/find/a?text=${encodeURIComponent(name)}`,
    noRedirect: true,
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
    fetchedAt: new Date().toISOString(),
  });
  return nregs;
}

export async function resolve(
  name: string,
  maxCandidates = 4,
): Promise<ResolveResult> {
  const nregs = await resolveNreg(name);
  if (nregs.length === 0) {
    return {
      query: name,
      chosen: null,
      candidates: [],
      ambiguous: true,
      note:
        `Реєстр не дав однозначної відповіді на «${name}». Список, який він ` +
        `повертає замість неї, відсортований ЗА ДАТОЮ, а не за релевантністю, ` +
        `тому потрібного акта в ньому може не бути взагалі. Спробуй початок ` +
        `офіційної назви («Про …») або номер акта («3543-XII»).`,
    };
  }

  const candidates: Candidate[] = [];
  for (const nreg of nregs.slice(0, maxCandidates)) {
    try {
      const meta = await getMeta(nreg);
      // An archived twin is rejected on the flag alone. Fetching its card would
      // spend a request against a rate-limited source only to read «Чинний» —
      // the very status that makes the twin a trap.
      const card = meta.isArchive ? undefined : await getCard(nreg);
      candidates.push({
        nreg: meta.nreg,
        title: card?.title || meta.nazva,
        statusText:
          card?.statusText ||
          (meta.isArchive ? "архівна редакція" : `код стану ${meta.statusCode}`),
        isArchive: meta.isArchive,
        currentRedaction: meta.currentRedaction,
        officialNumber: meta.officialNumber,
        verified: true,
      });
    } catch {
      // Unknown, not "fine". See the note on Candidate.isArchive.
      candidates.push({
        nreg,
        title: "",
        statusText: "реквізити не отримано",
        isArchive: null,
        currentRedaction: "",
        officialNumber: "",
        verified: false,
      });
    }
  }

  const { chosen, note } = selectAct(candidates);
  return { query: name, chosen, candidates, ambiguous: false, note };
}

/**
 * Pick the act to use from the resolver's candidates.
 *
 * Auto-selection requires a POSITIVE check that a candidate is neither archived
 * nor repealed. A candidate whose metadata could not be fetched is never
 * chosen: an unverified act may be an archived twin, and an archived twin is
 * precisely what produces a confidently-wrong, stale norm.
 */
export function selectAct(candidates: Candidate[]): {
  chosen: Candidate | null;
  note: string;
} {
  const live = candidates.filter(
    (c) =>
      c.verified &&
      c.isArchive === false &&
      !/втратив\s+чинн/i.test(c.statusText),
  );
  const chosen =
    live.length > 0
      ? [...live].sort((a, b) =>
          b.currentRedaction.localeCompare(a.currentRedaction),
        )[0]
      : null;

  const archived = candidates.filter((c) => c.isArchive === true).length;
  const repealed = candidates.filter(
    (c) => c.verified && /втратив\s+чинн/i.test(c.statusText),
  ).length;
  const unverified = candidates.filter((c) => !c.verified).length;
  const notes: string[] = [];

  if (archived > 0) {
    notes.push(
      `Відкинуто ${archived} архівн${archived === 1 ? "ий акт" : "і акти"}. ` +
        `Архівні «двійники» кодексів мають стан «Чинний», але містять ` +
        `застарілі норми — їх визначено за прапорцем is_archive, а не за назвою.`,
    );
  }
  if (repealed > 0) {
    notes.push(`Відкинуто ${repealed} акт(и), що втратили чинність.`);
  }
  if (unverified > 0) {
    notes.push(
      `☠️ ${unverified} кандидат${unverified === 1 ? "а" : "ів"} не перевірено ` +
        `(джерело не відповіло). ${unverified === 1 ? "Його" : "Їх"} НЕ обрано ` +
        `автоматично: непідтверджений акт може бути архівним, а архівний дає ` +
        `застарілу норму. Перевір вручну через rada_status.`,
    );
  }
  if (!chosen) {
    notes.push(
      "Жодного ПІДТВЕРДЖЕНО чинного акта не обрано. Не цитуй норму, поки акт " +
        "не підтверджено.",
    );
  }
  return { chosen, note: notes.join(" ") };
}

export const RADA_STATUS_NOTE =
  "Стан АКТА ≠ стан статті: у чинному акті бувають виключені статті. " +
  "Перевіряй конкретну одиницю через rada_unit.";
