/**
 * ЄДРСР — the state register of court decisions (reyestr.court.gov.ua).
 *
 * Request details ported from LEXERY's `edrsr.py` (Apache-2.0,
 * https://github.com/LEXERY-AI/lexery-ukrainian-law) — their measured traps are
 * the reason this module looks the way it does. Re-verified live 2026-09-20.
 *
 * Politeness is part of the contract: the register states its anti-bot exists
 * to prevent bulk «викачування». One request at a time, >=1.1 s apart (enforced
 * in http.ts), at most one search plus MAX_DOCS unique documents per question.
 */
import { request, SourceError } from "./http.ts";
import { htmlToText } from "./html.ts";

export const BASE = "https://reyestr.court.gov.ua";
/** Unique documents per user question. Re-reading an already-fetched id is free. */
export const MAX_DOCS = 8;

/**
 * ☠️ Never match on the word "captcha". The CAPTCHA modal (`#modalcaptcha`,
 * `CaptchaTestClick`) is inlined into EVERY page, including a perfectly normal
 * 50-row result set. Matching it makes every search look blocked. A real block
 * is visible prose.
 */
const BLOCK =
  /(перевірка\s+безпеки|доступ\s+(?:обмежено|заборонено)|занадто\s+багато\s+запитів|too\s+many\s+requests|тимчасово\s+недоступн)/i;

const FOUND = /знайдено\s+документів[:\s]*([\d\s  ]+)/i;
/**
 * A true-zero page carries NO «знайдено документів» counter at all; it carries
 * this sentence instead. So "no counter" alone means neither zero nor failure —
 * this phrase is what distinguishes them.
 */
const ZERO = /не\s+знайдено\s+жодного\s+документа/i;

export interface EdrsrRow {
  id: string;
  /** Форма рішення: Ухвала / Рішення / Постанова / Вирок. */
  form: string;
  /** Дата ухвалення, DD.MM.YYYY as the register prints it. */
  adjudicatedAt: string;
  publishedAt: string;
  proceedingForm: string;
  caseNumber: string;
  court: string;
  judge: string;
  url: string;
}

export type SearchStatus =
  | "ok"
  | "blocked"
  | "no_results_view"
  | "zero"
  | "http_error";

export interface EdrsrSearchResult {
  status: SearchStatus;
  /** Register's own counter. Caps at 100 000 — not a statistic beyond that. */
  found: number | null;
  countCapped: boolean;
  rows: EdrsrRow[];
  note: string;
}

export function parseFound(html: string): number | null {
  const m = FOUND.exec(html);
  if (m) return Number(m[1].replace(/\D/g, "")) || 0;
  return ZERO.test(html) ? 0 : null;
}

export function parseRows(html: string): EdrsrRow[] {
  const out: EdrsrRow[] = [];
  // 8 columns: id · форма · дата ухвалення · дата оприлюднення · форма
  // судочинства · № справи · суд · суддя. 100 rows arrive in ONE request, so
  // never fetch /Review just to rank results.
  for (const tr of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    if (!tr.includes("/Review/")) continue;
    const rid = /\/Review\/(\d+)/.exec(tr);
    if (!rid) continue;
    // htmlToText turns tags into spaces, so adjacent cell spans do not glue
    // into one word; a cell is a single line, so flatten any newlines.
    const cells = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? []).map((c) =>
      htmlToText(c).replace(/\s+/g, " ").trim(),
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
      url: `${BASE}/Review/${rid[1]}`,
    });
  }
  return out;
}

/**
 * ☠️ `CaseNumber` matches as a >=3-character SUBSTRING, so a search for one ЄУН
 * can come back holding rows that belong to other cases. Keep only the true
 * matches. If none survive, that is a zero result for THIS case — returning the
 * substring matches instead would present a stranger's case as the user's own.
 *
 * `substringOnly` records that the register did return rows, just none for this
 * case, so the caller can say which of the two happened.
 */
export function filterByCase(
  rows: EdrsrRow[],
  caseNumber?: string,
): { rows: EdrsrRow[]; substringOnly: boolean } {
  if (!caseNumber) return { rows, substringOnly: false };
  const want = caseNumber.replace(/\s/g, "");
  const kept = rows.filter((r) =>
    r.caseNumber.replace(/\s/g, "").startsWith(want),
  );
  return { rows: kept, substringOnly: kept.length === 0 && rows.length > 0 };
}

export interface EdrsrSearchInput {
  expression?: string;
  caseNumber?: string;
  regNumber?: string;
  judge?: string;
  courtCode?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Search the register.
 *
 * ☠️ Search is POST to `/`. A GET does NOT search: `GET /Page/1?CaseNumber=…`
 * returns HTTP 200, the word «знайдено» and ZERO rows — a false negative about
 * the user's own case. Never conclude absence from a GET.
 */
export async function search(
  input: EdrsrSearchInput,
): Promise<EdrsrSearchResult> {
  // A search is the start of a new question about the register.
  resetBudget();
  const form: Record<string, string> = {
    SearchExpression: input.expression ?? "",
    CaseNumber: input.caseNumber ?? "",
    RegNumber: input.regNumber ?? "",
    ChairmenName: input.judge ?? "",
    UserCourtCode: input.courtCode ?? "",
    RegDateBegin: input.dateFrom ?? "",
    RegDateEnd: input.dateTo ?? "",
    ImportDateBegin: "",
    ImportDateEnd: "",
    Sort: "0",
    "PagingInfo.ItemsPerPage": "100",
  };

  const res = await request("edrsr", { path: "/", form });
  if (res.status !== 200) {
    return {
      status: "http_error",
      found: null,
      countCapped: false,
      rows: [],
      note:
        `HTTP ${res.status}. Пошук НЕ виконано — не роби з цього висновку, ` +
        `що справи або практики не існує.`,
    };
  }
  if (BLOCK.test(res.body)) {
    return {
      status: "blocked",
      found: null,
      countCapped: false,
      rows: [],
      note:
        "СТОП: реєстр показав блок-сторінку. Обхід не виконується. " +
        "Повідом користувача і спробуй пізніше.",
    };
  }

  const found = parseFound(res.body);
  const rows = parseRows(res.body);

  if (found === null && rows.length === 0) {
    // Neither a counter nor rows: the results view did not render at all.
    // A broken request or a soft block — NOT «нічого не знайдено».
    return {
      status: "no_results_view",
      found: null,
      countCapped: false,
      rows: [],
      note:
        "Сторінка результатів не відрендерилась (ні лічильника, ні рядків). " +
        "Це НЕ «нічого не знайдено», а зламаний запит або м'який блок. " +
        "Не роби висновку про відсутність справи.",
    };
  }

  const { rows: filtered, substringOnly } = filterByCase(rows, input.caseNumber);

  if (filtered.length === 0) {
    return {
      status: "zero",
      found,
      countCapped: found === 100000,
      rows: [],
      note:
        (substringOnly
          ? `Реєстр повернув ${rows.length} рядків, але жоден не належить ` +
            `справі ${input.caseNumber} — пошук за номером справи працює як ` +
            `пошук підрядка. Для цієї справи результат нульовий. `
          : "") +
        "НУЛЬ рядків. Це «я не знайшов», а не «практики/справи немає». " +
        "Перевір: відмінок (додай `*` для морфології), стоп-слова " +
        "(ОСОБА, АДРЕСА, грн), літерний суфікс у номері справи, " +
        "ЄРДР у полі номера справи для кримінальних проваджень.",
    };
  }

  return {
    status: "ok",
    found,
    countCapped: found === 100000,
    rows: filtered,
    note:
      "Посилання лише як https://reyestr.court.gov.ua/Review/<id> — URL пошуку " +
      "не існує, пошук працює тільки через POST. Процесуального стану (чи " +
      "набрало рішення сили) в ЄДРСР НЕМАЄ — це court.gov.ua/fair.",
  };
}

// ────────────────────────────────────────────────────────────── documents

/**
 * Transit map, not a cache: it lives in this process only and never touches
 * disk.
 *
 * ☠️ ЄДРСР documents must never be persisted. Personal-data leaks are fixed by
 * re-masking the SAME document id (ст. 8 ч. 2-3 ЗУ № 3262-IV), so a disk cache
 * would keep serving personal data after the court withdrew it.
 */
const transit = new Map<string, string>();
let lastDocAt = 0;

/**
 * The documents budget is «per user question», but a long-lived stdio server
 * cannot see where one question ends. Two signals stand in for it:
 *  - a new search, which is how a new question about the register starts;
 *  - an idle gap, for a question that reuses ids already known to the caller.
 *
 * Without this the budget never resets and the 9th document of a session is
 * refused forever — the limit would stop being politeness and become a bug.
 */
const IDLE_RESET_MS = 10 * 60 * 1000;

export function docsFetched(): string[] {
  return [...transit.keys()];
}

export function resetBudget(): void {
  transit.clear();
  lastDocAt = 0;
}

function expireIdleBudget(): void {
  if (lastDocAt && Date.now() - lastDocAt > IDLE_RESET_MS) resetBudget();
}

/** Резолютивна частина markers — «чим закінчилось» lives at the very END. */
const OPERATIVE =
  /^\s*(ПОСТАНОВИВ|ПОСТАНОВИЛА|УХВАЛИВ|УХВАЛИЛА|ВИРІШИВ|ВИРІШИЛА|ЗАСУДИВ|ЗАСУДИЛА)\s*:?\s*$/m;

export type DocMode = "head" | "operative" | "grep" | "tail";

export interface EdrsrDocResult {
  id: string;
  url: string;
  mode: DocMode;
  text: string;
  totalChars: number;
  note: string;
}

/**
 * Read one document. `mode` picks WHICH part, so a single fetch answers the
 * question asked — head truncation otherwise hides the operative part entirely,
 * which is exactly what «чим закінчилась справа» needs.
 */
/** Characters returned per slice. A постанова runs to ~95 000. */
const CHUNK = 30_000;
/** Maximum grep hits returned; more than this is a sign to narrow the needle. */
const MAX_HITS = 25;

export async function document(
  id: string,
  mode: DocMode = "head",
  needle?: string,
): Promise<EdrsrDocResult> {
  if (!/^\d+$/.test(id)) {
    throw new SourceError(`ЄДРСР id має бути числом, отримано «${id}».`, "http");
  }

  expireIdleBudget();
  let body = transit.get(id);
  if (body === undefined) {
    if (transit.size >= MAX_DOCS) {
      throw new SourceError(
        `Ліміт ${MAX_DOCS} УНІКАЛЬНИХ документів на питання досягнуто. ` +
          `Вже завантажені читаються безкоштовно: ${docsFetched().join(", ")}. ` +
          `Новий пошук (edrsr_search) починає нове питання і скидає ліміт.`,
        "budget",
      );
    }
    const res = await request("edrsr", { path: `/Review/${id}` });
    if (res.status !== 200) {
      throw new SourceError(
        `ЄДРСР: HTTP ${res.status} для документа ${id}. Не перевірено.`,
        "http",
      );
    }
    if (BLOCK.test(res.body)) {
      throw new SourceError(
        "СТОП: реєстр показав блок-сторінку. Обхід не виконується.",
        "blocked",
      );
    }
    body = htmlToText(res.body);
    transit.set(id, body);
    lastDocAt = Date.now();
  }

  const url = `${BASE}/Review/${id}`;
  const total = body.length;
  let text: string;
  let note = "";

  if (mode === "operative") {
    const m = OPERATIVE.exec(body);
    if (m) {
      text = body.slice(m.index).slice(0, CHUNK);
      note = "Резолютивна частина — те, чим справа закінчилась.";
    } else {
      text = body.slice(-CHUNK);
      note =
        "Маркер резолютивної частини не знайдено — показано кінець документа. " +
        "Переконайся, що це справді резолютивна частина.";
    }
  } else if (mode === "grep") {
    if (!needle) {
      throw new SourceError("mode=grep потребує параметра needle.", "http");
    }
    const hits: string[] = [];
    const re = new RegExp(
      needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "giu",
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null && hits.length < MAX_HITS) {
      hits.push(
        body.slice(Math.max(0, m.index - 400), m.index + 600).trim(),
      );
      re.lastIndex = m.index + Math.max(1, needle.length);
    }
    text = hits.length
      ? hits.join("\n\n— — —\n\n")
      : `Слова «${needle}» у документі ${id} немає.`;
    note =
      hits.length === MAX_HITS
        ? `Показано перші ${MAX_HITS} згадок — їх може бути більше. ` +
          `Звузь слово, якщо потрібен точніший зріз.`
        : `${hits.length} згадок.`;
  } else if (mode === "tail") {
    text = body.slice(-CHUNK);
  } else {
    text = body.slice(0, CHUNK);
    if (total > CHUNK) {
      note =
        `Показано перші ${CHUNK} з ${total} знаків. Якщо потрібно, ` +
        `чим справа закінчилась — використай mode=operative, а не читай далі.`;
    }
  }

  lastDocAt = Date.now();
  return { id, url, mode, text, totalChars: total, note };
}

export const ANONYMISATION_NOTE =
  "Анонімізація (ст. 7 ЗУ № 3262-IV): якщо документ містить справжні " +
  "персональні дані, НЕ переноси їх у відповідь і НІКОЛИ не зв'язуй ОСОБА_N " +
  "між різними документами.";
