/**
 * ua-legal-sources — a local MCP server for Ukrainian legal sources.
 *
 * Runs on the user's own machine over stdio, so it uses the machine's own
 * network. That is the whole point: Claude's web fetch refuses rada hosts
 * (robots.txt) and the Cowork cloud shell is blocked from court.gov.ua, while
 * this Mac reaches all of them.
 *
 * Design rules that are NOT negotiable by a caller:
 *  - Every answer carries source_url and retrieved_at; law text also carries
 *    the redaction date it belongs to.
 *  - An empty result says where and how it searched. It never says "does not
 *    exist".
 *  - Politeness limits per host are enforced in http.ts, not left to the model.
 *  - ЄДРСР documents are never written to disk.
 *
 * Deliberately NOT implemented: case status from court.gov.ua/fair. That page
 * is gated by a reCAPTCHA v2 checkbox (verified 2026-09-20: the search button
 * fires no request at all until the CAPTCHA is solved). Solving or bypassing it
 * is off the table, so case status stays a human step — see README.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { SourceError } from "./http.ts";
import {
  buildIndex,
  getCard,
  getMeta,
  getText,
  isRealDate,
  listUnits,
  MAX_UNIT_CHARS,
  RADA_STATUS_NOTE,
  redactionAsOf,
  resolve,
  sliceUnit,
} from "./rada.ts";
import * as lpd from "./lpd.ts";
import * as edrsr from "./edrsr.ts";

const server = new McpServer(
  { name: "ua-legal-sources", version: "0.1.0" },
  {
    instructions:
      "Українські правові джерела з локальної машини. Використовуй ці " +
      "інструменти замість web fetch: rada_* для законодавства (офіційне API " +
      "data.rada.gov.ua), lpd_* для правових позицій ВС, edrsr_* для реєстру " +
      "судових рішень. Ніколи не цитуй норму з пам'яті. Порожній результат " +
      "означає «я не знайшов», а не «цього не існує». Стану справи " +
      "(чи набрало рішення сили) тут немає — court.gov.ua/fair під reCAPTCHA.",
  },
);

const now = () => new Date().toISOString();

/**
 * Every free-text argument has a ceiling. Measured: a 13 000-character law name
 * held zakon.rada for 57 s until the socket dropped, and tools that echo their
 * input turned a 20 000-character case number into ~8k tokens of reply. The
 * limits sit far above any real title, query or case number.
 */
const NREG = z.string().min(2).max(64);
const ID = z.string().regex(/^\d{1,12}$/);
/** ЄДРСР's own format is DD.MM.YYYY; ISO is accepted and converted. */
const COURT_DATE = z
  .string()
  .regex(/^(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})$/, "DD.MM.YYYY або YYYY-MM-DD");

/**
 * Every tool returns text; errors are returned as content, not thrown.
 *
 * Compact JSON, not pretty-printed: indentation is pure token cost to the user,
 * and Claude Code caps a tool result at 25 000 tokens (warning at 10 000).
 */
function ok(payload: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(payload) },
    ],
  };
}

function fail(err: unknown) {
  const e = err as SourceError;
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            error: e?.message ?? String(err),
            kind: e?.kind ?? "unknown",
            verified: false,
            // An input error never reached a source; saying "the source did not
            // answer" would send the model looking for an outage.
            reminder:
              e?.kind === "input"
                ? "Запит не надіслано: виправ вхідні дані й повтори."
                : e?.kind === "unavailable"
                  ? "Джерело відповіло, але документа не показало. Не цитуй його " +
                    "з пам'яті і не стверджуй, що його не існує."
                  : "Джерело не відповіло. Це НЕ підстава відповідати з пам'яті " +
                    "і НЕ доказ відсутності норми чи справи.",
          },
        ),
      },
    ],
  };
}

async function guard(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}

/**
 * The act's text as it stood on `date` — or today — with an honest label.
 *
 * ☠️ data.rada answers ANY `/ed<date>` with HTTP 200, including dates before the
 * act existed (it returns today's text). So the act's own redaction history
 * decides what to fetch and what to call it; the request date is never echoed
 * back as though it were the text's redaction.
 */
async function textAsOf(rawNreg: string, date?: string) {
  const meta = await getMeta(rawNreg);
  const current = () => getText(meta.nreg);
  if (!date) {
    return {
      meta,
      text: await current(),
      asOf: null,
      redactionDate: meta.currentRedaction,
      note: `Поточна редакція від ${meta.currentRedaction}.`,
    };
  }
  if (!isRealDate(date)) {
    throw new SourceError(
      `Дати «${date}» немає в календарі. Перевір день і місяць.`,
      "input",
    );
  }
  const a = redactionAsOf(meta, date, now().slice(0, 10));
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
      note:
        `${date} — у майбутньому. Показано чинну сьогодні редакцію від ` +
        `${meta.currentRedaction}. ` +
        (pending
          ? `Уже ухвалено ${pending} майбутніх редакцій, тож на ${date} текст ` +
            `може бути іншим.`
          : `Ухвалених майбутніх редакцій реєстр не показує.`),
    };
  }
  if (a.kind === "no-history") {
    return {
      meta,
      text: await current(),
      asOf: date,
      redactionDate: meta.currentRedaction,
      note:
        `Реєстр не веде історії редакцій цього акта, тож текст станом на ` +
        `${date} встановити неможливо. Показано поточну редакцію від ` +
        `${meta.currentRedaction} — НЕ подавай її як текст на ${date}.`,
    };
  }
  const r = a.redaction;
  // Every date inside one redaction shares one cached download.
  const isCurrent = r.date === meta.currentRedaction;
  return {
    meta,
    text: isCurrent ? await current() : await getText(meta.nreg, r.date),
    asOf: date,
    redactionDate: r.date,
    note:
      `Станом на ${date} у реєстрі — редакція від ${r.date}. Чи набрала вона ` +
      `на ту дату чинності, перевір у прикінцевих положеннях акта.`,
  };
}

function beforeExisted(nreg: string, title: string, date: string, first: string) {
  return {
    found: false,
    nreg,
    act_title: title,
    as_of: date,
    message:
      `На ${date} цього акта в реєстрі ще не було: перша редакція — ${first}. ` +
      `Тексту станом на цю дату не існує. Якщо відносини виникли раніше, ` +
      `застосовне право треба шукати в акті, що діяв тоді.`,
  };
}

// ──────────────────────────────────────────────────────── legislation tools

server.registerTool(
  "rada_resolve",
  {
    title: "Знайти акт за назвою або абревіатурою",
    description:
      "Перетворює назву чи абревіатуру акта («КУпАП», «ЦК», «Про мобілізаційну " +
      "підготовку та мобілізацію») на системний номер (nreg) і відкидає " +
      "архівні «двійники», які мають стан «Чинний», але містять застарілі " +
      "норми. Повертає обраний акт і всіх кандидатів із реквізитами. " +
      "Якщо реєстр не дав однозначної відповіді — прямо про це каже.",
    inputSchema: {
      name: z
        .string()
        .min(2)
        .max(300)
        .describe(
          "Абревіатура («КУпАП») або початок офіційної назви («Про …»). " +
            "Опис замість назви не працює.",
        ),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ name }) =>
    guard(async () => {
      const r = await resolve(name);
      return { ...r, retrieved_at: now(), act_vs_article: RADA_STATUS_NOTE };
    }),
);

server.registerTool(
  "rada_status",
  {
    title: "Чинність акта, поточна і майбутня редакція",
    description:
      "Стан акта за офіційною карткою (словом, не кодом), поточна редакція, " +
      "підстава, кількість редакцій і ПОПЕРЕДЖЕННЯ про вже ухвалені майбутні " +
      "редакції (зокрема ті, що набирають сили «пізніше», за подією). " +
      "Стан акта ≠ стан статті: перевіряй одиницю через rada_unit.",
    inputSchema: {
      nreg: NREG.describe("Системний номер, напр. «435-15», «8073-10», «254к/96-вр»."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ nreg }) =>
    guard(async () => {
      const meta = await getMeta(nreg);
      const card = await getCard(nreg);
      return {
        nreg: meta.nreg,
        title: card.title || meta.nazva,
        official_number: meta.officialNumber,
        status: card.statusText,
        status_code: meta.statusCode,
        is_archive: meta.isArchive,
        archive_warning: meta.isArchive
          ? "☠️ Це АРХІВНА редакція акта. Її стан може читатись як «Чинний», " +
            "але норми в ній застарілі. Не цитуй її — візьми чинний акт."
          : undefined,
        adopted: meta.adopted,
        current_redaction: meta.currentRedaction,
        basis: meta.basis,
        total_redactions: meta.totalRedactions,
        future_redactions: meta.futureRedactions,
        future_warning:
          meta.futureRedactions.length > 0
            ? "⚠️ Є ухвалені майбутні редакції. Те, що чинне сьогодні, " +
              "зміниться — скажи про це користувачу. Редакція з датою " +
              "«невизначена» набирає сили за подією, а не за календарем."
            : undefined,
        requisites: card.requisites,
        source_url: `https://data.rada.gov.ua/laws/card/${meta.nreg}`,
        retrieved_at: now(),
        note: RADA_STATUS_NOTE,
      };
    }),
);

server.registerTool(
  "rada_unit",
  {
    title: "Текст статті або іншої одиниці акта",
    description:
      "Дослівний текст однієї статті, розділу, глави, підрозділу чи параграфа. " +
      "Приймає «130», «ст.130», «1270», «111-1», «Розділ IV», «Підрозділ 1». " +
      "Окремо позначає, що статтю ВИКЛЮЧЕНО, і яким законом. Службові " +
      "позначки про зміни у {фігурних дужках} віддаються окремо від тексту " +
      "норми, щоб вони не потрапили в цитату. Параметр date дає редакцію " +
      "станом на дату. Повертає МАСИВ occurrences: якщо ambiguous=true, під цим " +
      "номером в акті є кілька різних статей (надрядкові номери в текстовому " +
      "експорті друкуються як звичайні) — тоді не вибирай сам, покажи обидві.",
    inputSchema: {
      nreg: NREG.describe("Системний номер акта, напр. «8073-10»."),
      unit: z
        .string()
        .min(1)
        .max(100)
        .describe("Номер статті або назва структурної одиниці."),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe(
          "YYYY-MM-DD — текст у редакції, чинній на цю дату. " +
            "Обов'язковий, коли питання стосується минулих подій.",
        ),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ nreg, unit, date }) =>
    guard(async () => {
      const t = await textAsOf(nreg, date);
      const { meta } = t;
      if (!t.text) {
        return beforeExisted(meta.nreg, meta.nazva, date!, t.firstRedaction!);
      }
      const text = t.text;
      const index = buildIndex(text.body);
      const u = sliceUnit(index, unit);

      if (!u.found) {
        return {
          found: false,
          nreg: meta.nreg,
          unit,
          message:
            `Одиницю «${unit}» в акті ${meta.nreg} не знайдено. Це означає «я не ` +
            `знайшов за цією адресою», а не «такої норми не існує». ` +
            `Ставки, перехідні й прикінцеві положення часто живуть у пунктах ` +
            `ПІДРОЗДІЛІВ, а не в статтях. Скористайся rada_list_units, щоб ` +
            `побачити зміст акта.`,
          articles_indexed: index.articles.size,
          source_url: text.sourceUrl,
          retrieved_at: text.retrievedAt,
        };
      }

      const occurrences = u.occurrences.map((o) => ({
        heading: o.heading,
        context: o.context,
        text: o.text,
        excluded: o.excluded,
        excluded_warning: o.excluded
          ? `☠️ Цю одиницю ВИКЛЮЧЕНО з акта (${o.excluded.basis}). Акт може ` +
            `бути чинним, але цієї норми вже немає.`
          : undefined,
        amendment_markers: o.markers,
        char_count: o.charCount,
        truncated_warning: o.truncated
          ? `Одиниця завелика: показано перші ${o.text.length} із ${o.charCount} ` +
            `знаків. Для цитування звузь адресу до окремої статті чи глави ` +
            `(зміст — rada_list_units).`
          : undefined,
      }));

      return {
        found: true,
        nreg: meta.nreg,
        act_title: meta.nazva,
        is_archive: meta.isArchive,
        unit: u.unit,
        ambiguous: u.ambiguous,
        ambiguity_warning: !u.ambiguous
          ? undefined
          : u.ambiguityReason === "repeated"
            ? `«${u.unit}» в акті ${meta.nreg} трапляється ${occurrences.length} ` +
              `рази — у різних частинах (див. поле context). Уточни, яку саме ` +
              `потрібно, або звузь адресу до глави чи статті.`
            : u.ambiguityReason === "flattened"
            ? `☠️ НЕОДНОЗНАЧНО: статті, надрукованої як «${unit}», в акті ` +
              `${meta.nreg} немає. Показано те, що надруковано без дефіса. ` +
              `У текстовому експорті надрядкові номери втрачають позначку, ` +
              `тому це може бути як ст. ${unit}, так і окрема стаття з таким ` +
              `номером. НЕ цитуй, не підтвердивши за карткою акта, що це та ` +
              `сама норма.`
            : `☠️ НЕОДНОЗНАЧНО: під номером «${u.unit}» в акті ${meta.nreg} є ` +
              `${occurrences.length} різні одиниці — надрядковий номер ` +
              `(напр. ст. 48-1) друкується так само, як звичайний (ст. 481). ` +
              `НЕ вибирай сам: покажи користувачу обидві (поле context — різні ` +
              `глави) і запитай, яка потрібна.`,
        occurrences,
        as_of: t.asOf,
        redaction_date: t.redactionDate,
        redaction_note: t.note,
        future_redactions: meta.futureRedactions.length,
        source_url: text.sourceUrl,
        retrieved_at: text.retrievedAt,
        from_cache: text.fromCache,
      };
    }),
);

server.registerTool(
  "rada_list_units",
  {
    title: "Перелік одиниць акта (зміст)",
    description:
      "Назви статей і структурних одиниць акта, з фільтром. Найдешевший спосіб " +
      "знайти, у якій саме одиниці живе потрібне питання, коли номер невідомий: " +
      "в українських кодексах назва статті майже завжди описує її предмет. " +
      "Фільтр «виключено» показує виключені статті.",
    inputSchema: {
      nreg: NREG,
      filter: z
        .string()
        .max(200)
        .optional()
        .describe("Підрядок для фільтрування назв, напр. «спадщин», «виключено»."),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ nreg, filter, date }) =>
    guard(async () => {
      const t = await textAsOf(nreg, date);
      if (!t.text) {
        return beforeExisted(t.meta.nreg, t.meta.nazva, date!, t.firstRedaction!);
      }
      const text = t.text;
      const index = buildIndex(text.body);
      const all = listUnits(index, filter);
      return {
        nreg: t.meta.nreg,
        as_of: t.asOf,
        redaction_date: t.redactionDate,
        redaction_note: t.note,
        filter: filter ?? null,
        total_articles: index.articles.size,
        total_structural: index.structural.length,
        matches: all.length,
        headings: all.slice(0, 400),
        truncated: all.length > 400,
        source_url: text.sourceUrl,
        retrieved_at: text.retrievedAt,
        from_cache: text.fromCache,
      };
    }),
);

// ─────────────────────────────────────────────────────── court practice (ЛПД)

server.registerTool(
  "lpd_search",
  {
    title: "Правові позиції Верховного Суду",
    description:
      "Пошук у базі правових позицій ВС (lpd.court.gov.ua). semantic=true " +
      "вмикає семантичний пошук — найкращий вхід у судову практику України. " +
      "Порожній результат не означає відсутності практики. Цитувати треба " +
      "постанову, до якої прив'язана позиція, а не саму базу.",
    inputSchema: {
      query: z.string().min(3).max(500).describe("Запит українською."),
      semantic: z
        .boolean()
        .optional()
        .describe("true — семантичний пошук (aiEnabled). За замовчуванням false."),
      limit: z.number().int().min(1).max(50).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ query, semantic, limit }) =>
    guard(async () => {
      const r = await lpd.searchPositions(query, semantic ?? false);
      return {
        query,
        semantic: r.semantic,
        returned: Math.min(r.positions.length, limit ?? 10),
        matched: r.positions.length,
        positions: r.positions.slice(0, limit ?? 10),
        note: r.note,
        retrieved_at: now(),
      };
    }),
);

server.registerTool(
  "lpd_position",
  {
    title: "Одна правова позиція ВС повністю",
    description:
      "Повний текст правової позиції ВС за її id, разом із прив'язаним " +
      "документом. Перед використанням перевір, чи не було відступу від неї.",
    inputSchema: { id: ID },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ id }) =>
    guard(async () => ({
      id,
      position: await lpd.position(id),
      source_url: `${lpd.SITE}/legal-position/${id}`,
      retrieved_at: now(),
    })),
);

server.registerTool(
  "lpd_digest_search",
  {
    title: "Огляди (дайджести) практики ВС",
    description:
      "Пошук в офіційних оглядах практики ВС із посиланням на PDF і сторінку. " +
      "Огляд — узагальнення самого суду, але НЕ джерело права: для аргументу " +
      "цитуй постанову, на яку огляд посилається.",
    inputSchema: { query: z.string().min(3).max(500) },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ query }) =>
    guard(async () => ({
      query,
      ...(await lpd.searchDigests(query)),
      retrieved_at: now(),
    })),
);

// ───────────────────────────────────────────────────────────── ЄДРСР tools

server.registerTool(
  "edrsr_search",
  {
    title: "Пошук у реєстрі судових рішень (ЄДРСР)",
    description:
      "Пошук у ЄДРСР. За номером справи (ЄУН) повертає ВСЮ історію справи " +
      "через усі інстанції — ЄУН незмінний. Граматика запиту: пробіл = AND, " +
      "OR/NOT великими, \"фраза\", word* префікс (потрібен для української " +
      "морфології). Стоп-слова (ОСОБА, АДРЕСА, грн) ігноруються. " +
      "Ліміт: один пошук на питання. Порожній результат = «я не знайшов».",
    inputSchema: {
      expression: z
        .string()
        .max(500)
        .optional()
        .describe("Текстовий запит, напр. «поновлен* прогул*»."),
      case_number: z
        .string()
        .max(40)
        .optional()
        .describe("ЄУН, напр. «522/2588/23». Для кримінальних — 17-цифровий ЄРДР."),
      reg_number: z.string().max(20).optional(),
      judge: z.string().max(100).optional().describe("Прізвище судді."),
      court_code: z.string().max(20).optional(),
      date_from: COURT_DATE.optional().describe("DD.MM.YYYY (YYYY-MM-DD теж приймається)"),
      date_to: COURT_DATE.optional().describe("DD.MM.YYYY (YYYY-MM-DD теж приймається)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) =>
    guard(async () => {
      if (
        !args.expression &&
        !args.case_number &&
        !args.reg_number &&
        !args.judge
      ) {
        throw new SourceError(
          "Потрібен хоча б один змістовний критерій: expression, " +
            "case_number, reg_number або judge. Порожній пошук у ЄДРСР " +
            "не робиться — це масова вибірка.",
          "input",
        );
      }
      const range = edrsr.courtDateRange(args.date_from, args.date_to);
      const r = await edrsr.search({
        expression: args.expression,
        caseNumber: args.case_number,
        regNumber: args.reg_number,
        judge: args.judge,
        courtCode: args.court_code,
        ...range,
      });
      return {
        ...r,
        count_warning: r.countCapped
          ? "Лічильник обрізано на 100 000 — не подавай його як статистику."
          : undefined,
        anonymisation: edrsr.ANONYMISATION_NOTE,
        retrieved_at: now(),
      };
    }),
);

server.registerTool(
  "edrsr_document",
  {
    title: "Текст судового рішення з ЄДРСР",
    description:
      "Читає один документ ЄДРСР. mode обирає ЯКУ частину, щоб одного запиту " +
      "вистачило: head — початок; operative — РЕЗОЛЮТИВНА частина, тобто чим " +
      "справа закінчилась (вона в самому кінці 95-тисячного тексту); " +
      "grep — згадки слова з контекстом; tail — кінець. Ліміт: 8 унікальних " +
      "документів на питання; вже завантажені читаються безкоштовно. " +
      "Документи ЄДРСР не зберігаються на диск.",
    inputSchema: {
      id: ID.describe("id документа з edrsr_search."),
      mode: z.enum(["head", "operative", "grep", "tail"]).optional(),
      needle: z.string().max(200).optional().describe("Слово для mode=grep."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ id, mode, needle }) =>
    guard(async () => ({
      ...(await edrsr.document(id, mode ?? "head", needle)),
      documents_used: edrsr.docsFetched().length,
      documents_budget: edrsr.MAX_DOCS,
      anonymisation: edrsr.ANONYMISATION_NOTE,
      retrieved_at: now(),
    })),
);

// ───────────────────────────────────────────────────────── case status (human)

server.registerTool(
  "case_status_instructions",
  {
    title: "Як перевірити процесуальний стан справи (крок для людини)",
    description:
      "Процесуальний стан справи (чи набрало рішення сили, коли засідання) " +
      "є лише на court.gov.ua/fair, і ця сторінка закрита reCAPTCHA. " +
      "Автоматично її не обходимо. Цей інструмент віддає покрокову " +
      "інструкцію для клієнта або адвоката, щоб зробити перевірку вручну.",
    inputSchema: {
      case_number: z.string().max(40).optional().describe("ЄУН, якщо відомий."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ case_number }) =>
    ok({
      why:
        "Пошук на court.gov.ua/fair захищений reCAPTCHA v2. Перевірено " +
        "2026-09-20: кнопка пошуку не надсилає жодного запиту, поки капчу не " +
        "пройдено. Обхід капчі не виконується — це робить людина.",
      steps: [
        "Відкрий https://court.gov.ua/fair/ у звичайному браузері.",
        `У поле «Номер справи» введи ${case_number ?? "ЄУН справи"}.`,
        "Пройди reCAPTCHA і натисни пошук.",
        "Скопіюй результат (стадія, остання подія, дата засідання) " +
          "і встав його сюди — я внесу це в CASE.md і перерахую строки.",
      ],
      alternatives: [
        "Електронний суд (cabinet.court.gov.ua) — офіційні повідомлення у справі, " +
          "якщо адвокат має там кабінет.",
        "edrsr_search за номером справи покаже нові ОПУБЛІКОВАНІ рішення, " +
          "але не процесуальний стан і не дати засідань.",
      ],
      retrieved_at: now(),
    }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
