/**
 * Parser tests on recorded fixtures.
 *
 * Every fixture is a verbatim response captured from data.rada.gov.ua on
 * 2026-09-20, so these tests pin the real traps, not invented ones. Two of them
 * mirror LEXERY's own eval cases (kupap-130-archive-twin, kupap-21-excluded),
 * which are the errors that look most plausible and hurt most.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildIndex,
  isRealDate,
  listUnits,
  MAX_UNIT_CHARS,
  normalizeNreg,
  parseCard,
  parseHistory,
  parseNregList,
  redactionAsOf,
  selectAct,
  sliceUnit,
  splitFuture,
  splitMarkers,
} from "../src/rada.ts";
import { encodeNreg } from "../src/http.ts";
import { mentionsQuery, queryStems } from "../src/lpd.ts";

const F = join(import.meta.dirname, "fixtures");
const read = (n: string) => readFileSync(join(F, n), "utf8");
const json = (n: string) => JSON.parse(read(n));

// ───────────────────────────────────────────────────────── card parsing

test("parseCard extracts the authoritative status word, not a numeric code", () => {
  const card = parseCard(read("card-435-15.html"), "435-15");
  assert.equal(card.statusText, "Чинний");
  assert.equal(card.title, "Цивільний кодекс України");
  assert.match(card.requisites, /№ 435-IV/);
  assert.match(card.issuer, /Верховна Рада України/);
});

// ───────────────────────────────────────── the archive-twin trap (ЄДРСР-grade)

test("is_archive separates the КУпАП twins that BOTH report status 5", () => {
  const live = json("meta-8073-10.json");
  const twin = json("meta-80731-10.json");

  // This is the trap: the status code is identical on both.
  assert.equal(live.status, 5);
  assert.equal(twin.status, 5);
  // Only the structured flag tells them apart.
  assert.equal(live.is_archive, 0);
  assert.equal(twin.is_archive, 1);
  assert.match(twin.nazva, /редакції до/);
});

// ───────────────────────────────────────────── redaction history + future

test("parseHistory reads the 3000-01-01 sentinel as conditional, not a date", () => {
  const meta = json("meta-435-15.json");
  const reds = parseHistory(meta.history);
  assert.ok(reds.length > 150, `expected many redactions, got ${reds.length}`);

  const sentinel = reds.filter((r) => r.conditional);
  assert.equal(sentinel.length, 1);
  assert.equal(sentinel[0].date, "невизначена");
  assert.equal(sentinel[0].raw, "30000101");
  assert.deepEqual(sentinel[0].basis, ["3153-20"]);

  // A real date is parsed as a date.
  const first = reds[0];
  assert.equal(first.date, "2003-01-16");
  assert.equal(first.conditional, false);
});

test("splitFuture surfaces a pending redaction the advocate must be told about", () => {
  const meta = json("meta-435-15.json");
  const { past, future } = splitFuture(parseHistory(meta.history), "2026-09-20");
  assert.ok(future.length >= 1);
  // The conditional one is always future.
  assert.ok(future.some((r) => r.conditional));
  // Nothing in `past` may be dated after the reference date.
  for (const r of past) assert.ok(r.date <= "2026-09-20", r.date);
});

// ───────────────────────────────────────────────────── brace markers

test("splitMarkers keeps amendment provenance out of the quotable norm", () => {
  const { clean, markers } = splitMarkers(
    "Частина перша тексту норми.\n{Частину другу статті 130 змінено згідно\n" +
      "із Законом № 3684-IX від 06.05.2024}\nЧастина третя.",
  );
  assert.equal(markers.length, 1);
  // ☠️ The tail of a multi-line marker must not leak into the quotation.
  assert.doesNotMatch(clean, /3684-IX/);
  assert.doesNotMatch(clean, /06\.05\.2024/);
  assert.match(clean, /Частина перша/);
  assert.match(clean, /Частина третя/);
  assert.match(markers[0], /3684-IX/);
});

test("splitMarkers survives nested braces without leaking a tail", () => {
  const { clean, markers } = splitMarkers("A {outer {inner} still-marker} B");
  assert.equal(markers.length, 1);
  assert.equal(clean.replace(/\s+/g, " ").trim(), "A B");
  assert.match(markers[0], /still-marker/);
});

// ─────────────────────────────────────────── unit slicing + excluded article

/** The single occurrence of an unambiguous address. */
const only = (idx: ReturnType<typeof buildIndex>, spec: string) => {
  const u = sliceUnit(idx, spec);
  assert.ok(u.found, `failed to address «${spec}»`);
  assert.equal(u.ambiguous, false, `«${spec}» unexpectedly ambiguous`);
  assert.equal(u.occurrences.length, 1);
  return u.occurrences[0];
};

test("sliceUnit returns ст.130 КУпАП with the CURRENT 1000-НМДГ penalty", () => {
  const o = only(buildIndex(read("kupap-excerpt.txt")), "130");
  assert.match(o.heading, /^Стаття 130\./);
  // The correct answer. The archive twin would say «шестисот».
  assert.match(o.text, /однієї тисячі неоподатковуваних мінімумів/);
  assert.doesNotMatch(o.text, /шестисот неоподатковуваних/);
  assert.equal(o.excluded, undefined);
});

test("sliceUnit reports ст.21 КУпАП as excluded, with the amending act", () => {
  const o = only(buildIndex(read("kupap-excerpt.txt")), "21");
  assert.ok(o.excluded, "ст.21 must be reported as excluded");
  assert.match(o.excluded!.basis, /2657-IX/);
  assert.match(o.excluded!.basis, /06\.10\.2022/);
});

test("article addressing accepts the shapes a lawyer actually types", () => {
  const idx = buildIndex(read("cc-excerpt.txt"));
  for (const spec of ["1270", "ст.1270", "ст. 1270", "st1270", "Стаття 1270"]) {
    assert.match(only(idx, spec).heading, /Стаття 1270\./);
  }
});

test("sliceUnit stops at the next article and does not bleed", () => {
  const o = only(buildIndex(read("cc-excerpt.txt")), "1270");
  assert.match(o.text, /шість місяців/);
  // ст.1272 is the next fixture article — it must not appear.
  assert.doesNotMatch(o.text, /Стаття 1272/);
});

test("a missing unit is reported as not found, with no occurrences", () => {
  const u = sliceUnit(buildIndex(read("cc-excerpt.txt")), "9999");
  assert.equal(u.found, false);
  assert.equal(u.ambiguous, false);
  assert.deepEqual(u.occurrences, []);
});

test("structural units are addressable, not just articles", () => {
  const o = only(buildIndex(read("kupap-excerpt.txt")), "Розділ I");
  assert.match(o.heading, /^Розділ I/);
});

// ──────────────────────── the superscript article-number collision (ЦК)

test("a colliding article number is reported as ambiguous, never resolved", () => {
  // ☠️ The regression: ЦК prints both ст. 48¹ and ст. 481 as «Стаття 481.»,
  // because the plain-text export flattens superscripts. Keeping only the first
  // occurrence silently answered «ст. 481» with ст. 48¹ — a confident citation
  // of an unrelated norm. Both must come back, with their chapters.
  const u = sliceUnit(buildIndex(read("cc-collision.txt")), "481");
  assert.ok(u.found);
  assert.equal(u.ambiguous, true, "481 must be flagged ambiguous");
  assert.equal(u.occurrences.length, 2);

  const [a, b] = u.occurrences;
  // Two entirely different norms under one printed number.
  assert.match(a.heading, /нездатності фізичної особи/);
  assert.match(b.heading, /раціоналізаторської пропозиції/);
  // `context` is what lets a human tell them apart.
  assert.equal(a.context, "Глава 4");
  assert.equal(b.context, "Глава 41");
  assert.notEqual(a.text, b.text);
});

test("a hyphenated request falls back to the flattened printed form", () => {
  // «48-1» is not printed with its hyphen anywhere in the export, so addressing
  // it must still reach the article rather than report it missing.
  const u = sliceUnit(buildIndex(read("cc-collision.txt")), "48-1");
  assert.ok(u.found, "«48-1» must resolve via the flattened «481» form");
  assert.equal(u.ambiguous, true);
});

test("an unambiguous article in the same act stays unambiguous", () => {
  const u = sliceUnit(buildIndex(read("cc-excerpt.txt")), "1270");
  assert.equal(u.ambiguous, false);
  assert.equal(u.occurrences.length, 1);
});

test("listUnits filters headings so a topic can be located cheaply", () => {
  const idx = buildIndex(read("cc-excerpt.txt"));
  const hits = listUnits(idx, "спадщин");
  assert.ok(hits.length >= 1);
  assert.ok(hits.some((h) => /Стаття 1270/.test(h)));
});

// ───────────────────────────────────── fail-safe act selection

const cand = (over: Partial<Parameters<typeof selectAct>[0][number]>) => ({
  nreg: "x",
  title: "t",
  statusText: "Чинний",
  isArchive: false as boolean | null,
  currentRedaction: "2026-01-01",
  officialNumber: "n",
  verified: true,
  ...over,
});

test("selectAct prefers the live act over its archived twins", () => {
  const { chosen, note } = selectAct([
    cand({ nreg: "8073-10", isArchive: false }),
    cand({ nreg: "80731-10", isArchive: true }),
    cand({ nreg: "80732-10", isArchive: true }),
  ]);
  assert.equal(chosen?.nreg, "8073-10");
  assert.match(note, /Відкинуто 2 архівні акти/);
});

test("selectAct NEVER auto-selects a candidate it could not verify", () => {
  // ☠️ The regression this guards: a failed metadata fetch used to default
  // isArchive to false, which let an unverified archive twin be chosen and a
  // repealed penalty be quoted as current.
  const { chosen, note } = selectAct([
    cand({ nreg: "80731-10", isArchive: null, verified: false, statusText: "реквізити не отримано" }),
  ]);
  assert.equal(chosen, null);
  assert.match(note, /не перевірено/);
  assert.match(note, /Не цитуй норму/);
});

test("selectAct still picks a verified act when another is unverified", () => {
  const { chosen, note } = selectAct([
    cand({ nreg: "8073-10", isArchive: false, verified: true }),
    cand({ nreg: "80731-10", isArchive: null, verified: false }),
  ]);
  assert.equal(chosen?.nreg, "8073-10");
  assert.match(note, /не перевірено/);
});

test("selectAct rejects a repealed act and says so", () => {
  const { chosen, note } = selectAct([
    cand({ nreg: "old-1", statusText: "Втратив чинність" }),
  ]);
  assert.equal(chosen, null);
  assert.match(note, /втратили чинність/);
});

test("selectAct prefers the newest redaction among live candidates", () => {
  const { chosen } = selectAct([
    cand({ nreg: "a", currentRedaction: "2020-05-01" }),
    cand({ nreg: "b", currentRedaction: "2026-08-05" }),
  ]);
  assert.equal(chosen?.nreg, "b");
});

// ──────────────────────── exclusion markers: the precision traps

test("a marker naming ANOTHER article does not mark this one excluded", () => {
  // ☠️ The regression: an excluded article keeps no heading, only its marker,
  // so `{Статтю 501 виключено}` sits inside the slice of ст.50. Matching the
  // marker without comparing numbers reported 6 LIVE articles of ЦК as
  // repealed — telling an advocate a norm in force no longer exists.
  const o = only(buildIndex(read("cc-exclusions.txt")), "50");
  assert.match(o.heading, /^Стаття 50\./);
  assert.equal(o.excluded, undefined, "ст.50 is in force and must not be flagged");
  // The marker is still reported as provenance, just not as this article's fate.
  assert.ok(o.markers.some((m) => /Статтю 501 виключено/.test(m)));
});

test("an exclusion marker written with a LATIN C is still detected", () => {
  // ☠️11 of 179 markers in ЦК spell «Cтаттю» with U+0043, not Cyrillic С.
  // A Cyrillic-only pattern reported those excluded articles as live.
  const u = sliceUnit(buildIndex(read("cc-exclusions.txt")), "991");
  assert.equal(u.ambiguous, true);
  assert.equal(u.ambiguityReason, "collision");
  const excluded = u.occurrences.filter((o) => o.excluded);
  assert.equal(excluded.length, 1, "exactly one of the two ст.991 is excluded");
  assert.match(excluded[0].excluded!.basis, /1909-IX/);
  // The live ст.99¹ carries an «доповнено» marker, which is not an exclusion.
  const live = u.occurrences.find((o) => !o.excluded);
  assert.ok(live, "ст.99-1 is in force");
  assert.match(live!.heading, /Посадові особи товариства/);
});

test("an article that exists only as an exclusion marker is reported excluded", () => {
  // Asking for it must give the legal answer, not «not found»: ст.50¹ was
  // excluded and therefore has no heading of its own left in the text.
  const u = sliceUnit(buildIndex(read("cc-exclusions.txt")), "501");
  assert.equal(u.found, true);
  assert.equal(u.occurrences.length, 1);
  assert.ok(u.occurrences[0].excluded);
  assert.match(u.occurrences[0].excluded!.basis, /1258-VII/);
});

test("a lossy hyphen fallback is flagged, not resolved silently", () => {
  // «50-1» is printed «501». Falling back is right, but the caller must know
  // the match may be a different article that prints the same way.
  const u = sliceUnit(buildIndex(read("cc-collision.txt")), "48-1");
  assert.equal(u.found, true);
  assert.equal(u.ambiguous, true);
});

// ──────────────────────── structural addressing precision

test("«Глава 4» does not also match «Глава 41»", () => {
  // ☠️ Plain prefix matching reported a false ambiguity between two unrelated
  // chapters, which would have pushed the model to ask a pointless question.
  const idx = buildIndex(read("cc-collision.txt"));
  for (const spec of ["Глава 4", "Глава 41"]) {
    const u = sliceUnit(idx, spec);
    assert.equal(u.ambiguous, false, `«${spec}» must be unambiguous`);
    assert.equal(u.occurrences.length, 1);
    assert.equal(u.occurrences[0].heading, spec);
  }
});

// ──────────────────────── CRLF, the way data.rada actually serves it

test("CRLF source text yields clean lines with no stray carriage returns", () => {
  // ☠️ data.rada serves CRLF, but fixtures written through Python's universal
  // newlines lost the \r — so this gap was invisible to every other test until
  // a live tool call showed \r\n inside a quotable norm.
  const crlf =
    "Глава 4\r\nСтаття 481. Заголовок\r\n1. Перша частина.\r\n" +
    "Глава 41\r\nСтаття 482. Інший\r\n1. Текст.\r\n";
  const u = sliceUnit(buildIndex(crlf), "481");
  assert.ok(u.found);
  const o = u.occurrences[0];
  assert.doesNotMatch(o.text, /\r/, "no \\r may survive into quotable text");
  assert.doesNotMatch(o.heading, /\r/);
  assert.equal(o.context, "Глава 4", "structural context must not keep a \\r");
  assert.match(o.text, /^1\. Перша частина\.$/m);
});

// ──────────────────────── the sentinel is a family, not one date

test("every year-3000 date is a conditional sentinel, not a date", () => {
  // ☠️ The regression: КУпАП carries 30000101, 30000102 AND 30000103 — the
  // registry walks the day to distinguish several pending event-conditional
  // redactions. Matching only «30000101» reported the others to an advocate as
  // literal dates «3000-01-02» and «3000-01-03».
  const reds = parseHistory(
    "20250101:0:111-20|30000101:0:2147а-19|30000102:0:3077-20|30000103:0:3256-20",
  );
  assert.equal(reds.length, 4);
  const sentinels = reds.filter((r) => r.conditional);
  assert.equal(sentinels.length, 3, "all three year-3000 entries are sentinels");
  for (const s of sentinels) {
    assert.equal(s.date, "невизначена");
    assert.doesNotMatch(s.date, /3000/, "no year-3000 date may be shown as a date");
  }
  // A real date is still a date.
  const real = reds.find((r) => !r.conditional);
  assert.equal(real!.date, "2025-01-01");
});

test("all year-3000 sentinels are classed as future", () => {
  const { past, future } = splitFuture(
    parseHistory("30000102:0:a|30000103:0:b|20200101:0:c"),
    "2026-09-21",
  );
  assert.equal(future.length, 2);
  assert.equal(past.length, 1);
});

// ──────────────────────── input hygiene (found by the adversarial run)

const EN_DASH = String.fromCharCode(0x2013);
const ZWSP = String.fromCharCode(0x200b);

test("normalizeNreg accepts what users actually paste", () => {
  assert.equal(normalizeNreg(" 435-15 "), "435-15");
  assert.equal(normalizeNreg(`435${EN_DASH}15`), "435-15");
  assert.equal(normalizeNreg(`435${ZWSP}-15`), "435-15");
  assert.equal(normalizeNreg("254к/96-вр"), "254к/96-вр");
});

test("normalizeNreg refuses path traversal and URL syntax", () => {
  // ☠️ The regression: `../../laws/main/r` reached /laws/main/r.json on the
  // state server, because URL resolution normalises `..` away after encoding.
  for (const bad of [
    "../../laws/main/r", "435-15/../../x", "./435-15", "/435-15", "435-15/",
    "435-15?x=1", "435-15#f", "435%2F15", "435 15", "435\\15", "", "a".repeat(65),
  ]) {
    assert.throws(() => normalizeNreg(bad), /nreg/, `should refuse ${JSON.stringify(bad)}`);
  }
});

test("encodeNreg refuses a dot segment even if a caller skipped normalising", () => {
  assert.throws(() => encodeNreg("a/../b"));
  assert.equal(encodeNreg("254к/96-вр"), "254%D0%BA/96-%D0%B2%D1%80");
});

test("isRealDate rejects dates that do not exist", () => {
  assert.equal(isRealDate("2024-02-29"), true);
  for (const d of ["2025-02-29", "2025-02-30", "2025-13-01", "2025-04-31", "2025-00-10"]) {
    assert.equal(isRealDate(d), false, d);
  }
});

// ──────────────────────── which redaction applies on a date

const meta = (history: string, adopted?: string) => ({
  nreg: "x", nazva: "t", officialNumber: "", statusCode: 5, isArchive: false,
  currentRedaction: "2026-08-05", adopted, basis: [],
  redactions: parseHistory(history), futureRedactions: [], totalRedactions: 0,
});

test("a date before the act's first redaction is 'before', not today's text", () => {
  // ☠️ The regression: data.rada answered ed19900101 for ЦК (adopted 2003) with
  // HTTP 200 and TODAY's text, which was then labelled «станом на 1990-01-01».
  const a = redactionAsOf(meta("20030116:4:|20040101:0:x|20260805:0:y"), "1990-01-01", "2026-09-21");
  assert.equal(a.kind, "before");
  assert.equal(a.kind === "before" && a.firstRedaction, "2003-01-16");
});

test("the redaction in force is the latest one on or before the date", () => {
  const m = meta("20030116:4:|20040101:0:x|20150206:0:y|20260805:0:z");
  const between = redactionAsOf(m, "2015-01-01", "2026-09-21");
  assert.equal(between.kind === "in-force" && between.redaction.date, "2004-01-01");
  const exact = redactionAsOf(m, "2015-02-06", "2026-09-21");
  assert.equal(exact.kind === "in-force" && exact.redaction.date, "2015-02-06");
});

test("a future date is flagged, not silently answered with today's text", () => {
  assert.equal(redactionAsOf(meta("20260805:0:z"), "2099-01-01", "2026-09-21").kind, "future");
});

test("no history is not the same as 'did not exist'", () => {
  assert.equal(redactionAsOf(meta("", "2003-01-16"), "2010-01-01", "2026-09-21").kind, "no-history");
  assert.equal(redactionAsOf(meta("", "2003-01-16"), "1990-01-01", "2026-09-21").kind, "before");
});

// ──────────────────────── structural units carry their contents

const STRUCT = [
  "Книга 1", "Розділ I", "Глава 1",
  "Стаття 1. Перша", "Текст першої.",
  "Стаття 2. Друга", "Текст другої.",
  "Глава 2",
  "Стаття 3. Третя", "Текст третьої.",
  "Розділ II", "Глава 3",
  "Стаття 4. Четверта", "Текст четвертої.",
].join("\n");

test("a Глава includes its articles and stops at the next Глава", () => {
  // ☠️ The regression: every structural unit stopped at the first heading of
  // any kind, so «Книга 5» of ЦК came back as its own title — 480 characters.
  const o = only(buildIndex(STRUCT), "Глава 1");
  assert.match(o.text, /Стаття 1/);
  assert.match(o.text, /Стаття 2/);
  assert.doesNotMatch(o.text, /Стаття 3/);
});

test("a Розділ includes its Глави and stops at the next Розділ", () => {
  const o = only(buildIndex(STRUCT), "Розділ I");
  assert.match(o.text, /Глава 2/);
  assert.match(o.text, /Стаття 3/);
  assert.doesNotMatch(o.text, /Стаття 4/);
});

test("an article still stops at the next article", () => {
  const o = only(buildIndex(STRUCT), "1");
  assert.match(o.text, /Текст першої/);
  assert.doesNotMatch(o.text, /Стаття 2/);
});

test("an oversized unit is truncated and says so", () => {
  const big = "Книга 9\n" + "Стаття 9. Велика\n" + "ї".repeat(MAX_UNIT_CHARS + 5000);
  const o = only(buildIndex(big), "Книга 9");
  assert.equal(o.truncated, true);
  assert.equal(o.text.length, MAX_UNIT_CHARS);
  assert.ok(o.charCount > MAX_UNIT_CHARS);
});

test("an article number typed with an en dash is found", () => {
  const u = sliceUnit(buildIndex("Стаття 111-1. Колабораційна діяльність\nТекст."), `111${EN_DASH}1`);
  assert.ok(u.found);
  assert.equal(u.ambiguous, false);
});

// ──────────────────────── structural addresses as a lawyer types them

const BOOKS = [
  "КНИГА ПЕРША", "Розділ I", "Глава 1", "Стаття 1. А", "Текст А.",
  "КНИГА П'ЯТА", "Розділ I", "Глава 50", "Стаття 500. Б", "Текст Б.",
].join("\n");

test("«Книга 5» finds ЦК's «КНИГА П'ЯТА»", () => {
  const o = only(buildIndex(BOOKS), "Книга 5");
  assert.equal(o.heading, "КНИГА П'ЯТА");
  assert.match(o.text, /Стаття 500/);
});

test("any apostrophe a user types matches «П'ЯТА»", () => {
  for (const code of [0x2019, 0x02bc, 0x27]) {
    const spec = `Книга п${String.fromCharCode(code)}ята`;
    assert.equal(only(buildIndex(BOOKS), spec).heading, "КНИГА П'ЯТА", `apostrophe U+${code.toString(16)}`);
  }
});

test("«Розділ 1» finds «Розділ I», and says it recurs", () => {
  const u = sliceUnit(buildIndex(BOOKS), "Розділ 1");
  assert.ok(u.found);
  assert.equal(u.occurrences.length, 2);
  assert.equal(u.ambiguous, true);
  assert.equal(u.ambiguityReason, "repeated");
});

test("repeated units share ONE size budget, so the answer stays under the cap", () => {
  // ☠️ The regression: three «Розділ I» in ЦК, each capped separately, summed to
  // ~26k tokens — over Claude Code's 25k hard limit on a tool result.
  const huge = "ї".repeat(MAX_UNIT_CHARS);
  const text = ["Розділ I", huge, "Розділ II", "x", "Розділ I", huge, "Розділ III", "x", "Розділ I", huge].join("\n");
  const u = sliceUnit(buildIndex(text), "Розділ I");
  assert.equal(u.occurrences.length, 3);
  const total = u.occurrences.reduce((n, o) => n + o.text.length, 0);
  assert.ok(total <= MAX_UNIT_CHARS, `total ${total} > ${MAX_UNIT_CHARS}`);
  assert.ok(u.occurrences.every((o) => o.truncated));
});

test("the fallback never shadows a heading written the way it was asked for", () => {
  const u = sliceUnit(buildIndex("Розділ 1\nТекст.\nРозділ I\nІнше."), "Розділ 1");
  assert.equal(u.occurrences.length, 1);
  assert.equal(u.occurrences[0].heading, "Розділ 1");
});

// ──────────────────────── ЛПД: a search that matched nothing


test("query stems survive Ukrainian inflection", () => {
  assert.deepEqual(queryStems("Поновлення на роботі"), ["понов", "робот"]);
  assert.ok(mentionsQuery("Працівника поновлено на роботу", queryStems("поновлення на роботі")));
});

test("gibberish matches no real position", () => {
  // ☠️ The regression: ЛПД returns ten unrelated positions for «qwzx».
  const stems = queryStems("qwzx");
  assert.equal(mentionsQuery("Єдине продовжуване хуліганство (ст. 296 КК)", stems), false);
});

test("short words alone produce no stems, so nothing is filtered on them", () => {
  assert.deepEqual(queryStems("ст 12"), []);
});

test("resolver cache: only a non-empty list of strings is trusted", () => {
  assert.deepEqual(parseNregList('["435-15","8073-10"]'), ["435-15", "8073-10"]);
  // ☠️ A corrupted entry crashed rada_resolve instead of refetching.
  for (const body of ['"not-an-array"', "[]", "[1,2]", "{", "null"]) {
    assert.equal(parseNregList(body), undefined, body);
  }
});
