/**
 * Live smoke test — hits the real Ukrainian state sources from this machine.
 *
 * Not part of `npm test`: it needs network, and it spends real requests against
 * rate-limited public services. Run it deliberately: `npm run smoke`.
 *
 * It stays inside the politeness budget: data.rada requests are 5–7 s apart
 * (enforced in http.ts), and it makes ONE ЄДРСР search plus ONE document read.
 */
import { strict as assert } from "node:assert";
import {
  buildIndex,
  getCard,
  getMeta,
  getText,
  resolve,
  sliceUnit,
} from "../src/rada.ts";
import * as lpd from "../src/lpd.ts";
import * as edrsr from "../src/edrsr.ts";

let pass = 0;
let fail = 0;

async function step(name: string, fn: () => Promise<string>) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    pass++;
    console.log(`✔ ${name}  (${Date.now() - t0} ms)\n    ${detail}`);
  } catch (err) {
    fail++;
    console.log(`✖ ${name}  (${Date.now() - t0} ms)\n    ${(err as Error).message}`);
  }
}

console.log("=== ua-legal-sources live smoke test ===\n");

// 1 ─ legislation metadata
await step("rada card + meta: ЦК 435-15 is current, not archived", async () => {
  const [meta, card] = [await getMeta("435-15"), await getCard("435-15")];
  assert.equal(card.statusText, "Чинний");
  assert.equal(meta.isArchive, false);
  assert.equal(meta.officialNumber, "435-IV");
  assert.ok(meta.totalRedactions > 150);
  return `«${card.title}», стан «${card.statusText}», редакція ${meta.currentRedaction}, ` +
    `редакцій ${meta.totalRedactions}, майбутніх ${meta.futureRedactions.length}`;
});

// 2 ─ the archive-twin trap, end to end through the resolver
await step("rada_resolve КУпАП rejects both archive twins", async () => {
  const r = await resolve("КУпАП");
  assert.ok(r.chosen, "no act chosen");
  assert.equal(r.chosen!.nreg, "8073-10");
  assert.equal(r.chosen!.isArchive, false);
  const archived = r.candidates.filter((c) => c.isArchive);
  assert.ok(archived.length >= 2, "expected the two archived twins");
  // The trap: the archived twins also read «Чинний».
  assert.ok(archived.every((c) => /Чинний/i.test(c.statusText)));
  return `обрано ${r.chosen!.nreg}; відкинуто архівні: ` +
    archived.map((c) => `${c.nreg} («${c.statusText}»)`).join(", ");
});

// 3 ─ the article that the archive twin would get wrong
await step("rada_unit ст.130 КУпАП gives the CURRENT 1000-НМДГ penalty", async () => {
  const text = await getText("8073-10");
  const u = sliceUnit(buildIndex(text.body), "130");
  assert.ok(u.found);
  assert.equal(u.ambiguous, false);
  const o = u.occurrences[0];
  assert.match(o.text, /однієї тисячі неоподатковуваних мінімумів/);
  assert.doesNotMatch(o.text, /шестисот неоподатковуваних/);
  return `${o.heading.slice(0, 60)}… (${o.charCount} знаків, ` +
    `${o.markers.length} службових позначок, ${o.context})`;
});

// 4 ─ act live, article excluded
await step("rada_unit ст.21 КУпАП reports exclusion with the amending act", async () => {
  const text = await getText("8073-10");
  const u = sliceUnit(buildIndex(text.body), "21");
  const o = u.occurrences[0];
  assert.ok(o?.excluded, "ст.21 must be flagged as excluded");
  assert.match(o.excluded!.basis, /2657-IX/);
  return `виключено: ${o.excluded!.basis}`;
});

// 4b ─ the superscript collision, against the live full text of ЦК
await step("rada_unit flags the real ст.48¹/ст.481 collision in ЦК", async () => {
  const text = await getText("435-15");
  const u = sliceUnit(buildIndex(text.body), "481");
  assert.ok(u.found);
  assert.equal(u.ambiguous, true, "481 must be ambiguous in the live ЦК text");
  assert.equal(u.occurrences.length, 2);
  const ctx = u.occurrences.map((o) => o.context);
  assert.notEqual(ctx[0], ctx[1]);
  return `2 різні статті під номером 481: ${ctx.join(" / ")}`;
});

// 5 ─ historical redaction through open data
await step("rada_unit honours a historical redaction date", async () => {
  const now = await getText("435-15");
  const then = await getText("435-15", "2015-01-01");
  assert.notEqual(now.body.length, then.body.length);
  assert.ok(sliceUnit(buildIndex(then.body), "1270").found);
  return `поточна ${now.body.length} байт vs ред. 2015-01-01 ${then.body.length} байт; ` +
    `ст.1270 знайдено в історичній редакції`;
});

// 6 ─ Supreme Court legal positions
await step("lpd_search returns Supreme Court positions", async () => {
  const r = await lpd.searchPositions("поновлення на роботі");
  assert.ok(r.positions.length > 0, "no positions");
  const first = r.positions[0];
  assert.ok(first.title.length > 10);
  assert.match(first.url, /lpd\.court\.gov\.ua\/legal-position\/\d+/);
  return `${r.positions.length} позицій; перша: «${first.title.slice(0, 70)}…»`;
});

// 7 ─ ЄДРСР: one search, full case history across instances
await step("edrsr_search by ЄУН returns the whole case history", async () => {
  const r = await edrsr.search({ caseNumber: "522/2588/23" });
  assert.equal(r.status, "ok", `status=${r.status}: ${r.note}`);
  assert.ok(r.rows.length > 5, `only ${r.rows.length} rows`);
  const courts = new Set(r.rows.map((x) => x.court));
  assert.ok(courts.size >= 3, "expected several instances");
  return `знайдено ${r.found}, рядків ${r.rows.length}, інстанцій ${courts.size}`;
});

// 8 ─ ЄДРСР: the operative part, which is what "how did it end" means
await step("edrsr_document mode=operative reaches the резолютивна частина", async () => {
  const d = await edrsr.document("124629922", "operative");
  assert.ok(d.totalChars > 10_000, `document only ${d.totalChars} chars`);
  assert.match(d.text, /(ПОСТАНОВИВ|ПОСТАНОВИЛА|УХВАЛИВ|УХВАЛИЛА)/);
  return `${d.totalChars} знаків усього; резолютивна частина знайдена ` +
    `(${d.text.length} знаків зрізу)`;
});

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
