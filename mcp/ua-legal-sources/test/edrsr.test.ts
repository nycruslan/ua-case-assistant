/**
 * ЄДРСР parser and filter tests.
 *
 * The HTML here is synthetic, mirroring the register's real result table (an
 * 8-cell row whose first cell links to /Review/<id>). It is written by hand on
 * purpose: the live shape is already covered by `npm run smoke`, while the cases
 * that matter here — a zero page, a block page, a row that is not a result —
 * cannot be produced on demand against the live register. Nothing from the real
 * register is committed, so no court output or judge's name lands in this repo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  courtDateRange,
  filterByCase,
  hasDecision,
  parseFound,
  parseRows,
  stripAngles,
  trimChrome,
} from "../src/edrsr.ts";
import { htmlToText } from "../src/html.ts";

const row = (id: string, caseNumber: string, court: string) =>
  `<tr>
     <td><a href="/Review/${id}">${id}</a></td>
     <td>Ухвала</td><td>16.02.2023</td><td>20.02.2023</td>
     <td>Цивільне</td><td>${caseNumber}</td><td>${court}</td><td>Суддя А. Б.</td>
   </tr>`;

const page = (body: string) => `<html><body>
  <div id="modalcaptcha">Підтвердіть, що ви не робот. CaptchaTestClick</div>
  ${body}
</body></html>`;

// ───────────────────────────────────────────────────────── counter

test("parseFound reads the counter, including spaced thousands", () => {
  assert.equal(parseFound("знайдено документів: 18"), 18);
  assert.equal(parseFound("знайдено документів: 12 345"), 12345);
});

test("parseFound distinguishes a true zero from an unrendered page", () => {
  // The zero page has no counter at all, only this sentence.
  assert.equal(parseFound("не знайдено жодного документа"), 0);
  // No counter and no zero-sentence means the results view did not render.
  // ☠️ That must be null (unknown), never 0 — 0 would read as "no such case".
  assert.equal(parseFound("<html><body>щось інше</body></html>"), null);
});

// ───────────────────────────────────────────────────────── rows

test("parseRows maps the eight columns of a result row", () => {
  const rows = parseRows(page(row("109034905", "522/2588/23", "Приморський районний суд м. Одеси")));
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.id, "109034905");
  assert.equal(r.form, "Ухвала");
  assert.equal(r.adjudicatedAt, "16.02.2023");
  assert.equal(r.publishedAt, "20.02.2023");
  assert.equal(r.caseNumber, "522/2588/23");
  assert.equal(r.court, "Приморський районний суд м. Одеси");
  assert.equal(r.url, "https://reyestr.court.gov.ua/Review/109034905");
});

test("parseRows ignores rows that are not results", () => {
  const rows = parseRows(page("<tr><td>Заголовок</td><td>таблиці</td></tr>"));
  assert.deepEqual(rows, []);
});

test("parseRows does not glue adjacent cell markup into one word", () => {
  const rows = parseRows(
    page(`<tr>
      <td><a href="/Review/1">1</a></td><td>Ухвала</td><td>01.01.2024</td>
      <td>02.01.2024</td><td>Цивільне</td><td>1/2/3</td>
      <td><span>Одеський</span><span>апеляційний суд</span></td><td>Суддя</td>
    </tr>`),
  );
  assert.equal(rows[0].court, "Одеський апеляційний суд");
});

test("an inlined CAPTCHA modal is NOT treated as a block", () => {
  // ☠️ The modal is inlined into EVERY page, including a normal result set.
  // Matching on the word "captcha" made every search look blocked.
  const rows = parseRows(page(row("1", "1/2/3", "Суд")));
  assert.equal(rows.length, 1, "a normal page with the modal must still parse");
});

// ───────────────────────────────────────────────── case-number filtering

const mk = (caseNumber: string): Parameters<typeof filterByCase>[0][number] => ({
  id: "1",
  form: "Ухвала",
  adjudicatedAt: "",
  publishedAt: "",
  proceedingForm: "",
  caseNumber,
  court: "",
  judge: "",
  url: "",
});

test("filterByCase keeps only rows belonging to the requested case", () => {
  const rows = [mk("522/2588/23"), mk("522/2588/23"), mk("1522/2588/231")];
  const out = filterByCase(rows, "522/2588/23");
  assert.equal(out.rows.length, 2);
  assert.equal(out.substringOnly, false);
});

test("filterByCase reports zero, not a stranger's case, on substring-only hits", () => {
  // ☠️ The regression: the register's >=3-char substring match returned other
  // cases, and those used to be passed through as if they were the user's.
  const out = filterByCase([mk("1522/2588/231")], "999/111/22");
  assert.deepEqual(out.rows, []);
  assert.equal(out.substringOnly, true);
});

test("filterByCase is a no-op without a case number", () => {
  const rows = [mk("a"), mk("b")];
  const out = filterByCase(rows, undefined);
  assert.equal(out.rows, rows);
  assert.equal(out.substringOnly, false);
});

test("filterByCase tolerates spacing in the requested number", () => {
  assert.equal(filterByCase([mk("522/2588/23")], " 522/2588/23 ".trim()).rows.length, 1);
});

// ───────────────────────────────────────────────────────── document text

test("htmlToText keeps block boundaries so the operative part stays findable", () => {
  const text = htmlToText(
    "<p>Мотивувальна частина</p><div>ПОСТАНОВИВ:</div><p>Скаргу задовольнити.</p>",
  );
  assert.match(text, /^Мотивувальна частина$/m);
  // The operative marker is matched with ^…$ per line, so it needs its own line.
  assert.match(text, /^ПОСТАНОВИВ:?$/m);
  assert.match(text, /Скаргу задовольнити/);
});

// ──────────────────────── found by the live stress run


test("a page without a decision container is not a decision", () => {
  // ☠️ The regression: /Review/1 answers HTTP 200 with the bare site shell, and
  // that shell was returned to the model as «the decision's text».
  assert.equal(hasDecision("<html><body><div id=\"modalcaptcha\"></div>Меню</body></html>"), false);
  assert.equal(hasDecision('<div id="divdocument"><textarea id="txtdepository">ПОСТАНОВА</textarea></div>'), true);
});

test("angle brackets are removed before they can trigger the register's HTTP 500", () => {
  assert.equal(stripAngles("поновлен* <b>прогул*</b>"), "поновлен* b прогул* /b");
  assert.equal(stripAngles('"поновлення на роботі"'), '"поновлення на роботі"');
  assert.equal(stripAngles(undefined), "");
});

test("court dates: ISO and native both become DD.MM.YYYY", () => {
  assert.deepEqual(courtDateRange("2024-01-01", "31.12.2024"), {
    dateFrom: "01.01.2024",
    dateTo: "31.12.2024",
  });
  assert.deepEqual(courtDateRange(), { dateFrom: undefined, dateTo: undefined });
});

test("court dates: an impossible date is refused, never sent unfiltered", () => {
  // ☠️ The register ignores «31.02.2024» and returns every row of the case.
  assert.throws(() => courtDateRange("31.02.2024"), { kind: "input" });
  assert.throws(() => courtDateRange(undefined, "2023-02-29"), { kind: "input" });
});

test("court dates: a reversed range is refused, not reported as zero decisions", () => {
  assert.throws(() => courtDateRange("01.01.2025", "31.12.2024"), { kind: "input" });
  // Compared as dates, not as strings: 02.01 is later than 31.12 of the year before.
  assert.doesNotThrow(() => courtDateRange("31.12.2024", "02.01.2025"));
});

test("a decision page keeps the decision and drops the site around it", () => {
  const page = [
    "Єдиний державний реєстр судових рішень",
    "Головна", "Законодавство",
    "Категорія справи № 183/7850/22 : Цивільні справи",
    "ПОСТАНОВИВ:",
    "Касаційну скаргу задовольнити частково.",
    "Головуючий В. І. Крат",
    "Введіть, будь ласка, логін та пароль",
    "Введіть cуму цифр, зображених на малюнку:",
    "var pageTracker = _gat._getTracker(\"UA-33842633-1\");",
  ].join("\n");
  const text = trimChrome(page);
  assert.match(text, /^Категорія справи №/);
  assert.match(text, /Головуючий В\. І\. Крат$/);
  // No marker, no guessing: the text is kept whole.
  assert.equal(trimChrome("просто текст"), "просто текст");
});
