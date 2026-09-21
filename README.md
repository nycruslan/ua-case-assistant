# ua-case-assistant — Ukrainian legal case assistant for Claude

A Claude plugin for working **one Ukrainian legal case** as a pair: the client (a non-lawyer) and their
advocate, sharing one case folder. Ten skills in Ukrainian cover the full cycle — setup, case profile,
analysis, chronology and evidence, procedural deadlines, drafting, pre-filing check, monitoring,
plain-language explanations — backed by a local MCP server that reads the official Ukrainian sources directly.

> ## ⚠️ Це не юридична консультація
>
> Усе, що виробляє цей плагін, — **чернетки для перевірки адвокатом**. Claude не підписує, не подає і не
> надсилає жодного документа: це робить лише людина. Норми й судова практика перевіряються за первинними
> джерелами в момент запиту; неперевірене позначається `[НЕ ПЕРЕВІРЕНО]`.
>
> **This is not legal advice.** Everything this plugin produces is a draft for an advocate to review. Claude
> never signs, files or sends anything.

## Install

Works in **Claude Code** and **Claude Cowork**.

```
/plugin marketplace add nycruslan/ua-case-assistant
/plugin install ua-case-assistant@ua-legal
```

Then **restart** the app once. Claude Code connects a plugin's MCP server at session start, so the tools
appear in your next session, not the current one. After that, run:

```
/ua-case-assistant:setup
```

That checks which sources are reachable, offers to install the companion LEXERY plugin, and creates your
private case folder.

**Recommended alongside** — [LEXERY Ukrainian Law](https://github.com/LEXERY-AI/lexery-ukrainian-law), whose
verification method these skills build on:

```
/plugin marketplace add LEXERY-AI/lexery-ukrainian-law
/plugin install lexery-ukrainian-law@lexery
```

**Requirements:** a paid Claude plan (plugins), and **Node.js 20+** for the bundled MCP server. Nothing to
`npm install` — the server ships as one pre-built file with no dependencies.

**Platforms:** tested on macOS. The tools start through a POSIX `sh` launcher, so Linux should behave the
same; on Windows the ten skills work, but the tools need `sh` on `PATH` (WSL or Git Bash) and are untested
there.

## What you get

| Skill | For | Example |
|---|---|---|
| `setup` | first run: check sources, create the case folder | `/ua-case-assistant:setup` |
| `case-setup` | interview, index documents, write `CASE.md` | «налаштуй справу» |
| `ua-law-research` | find and verify a norm or court practice | «яка редакція ст. 1270 ЦК чинна?» |
| `case-analysis` | legal memo, risks, strategy | «проаналізуй справу» |
| `chronology-evidence` | `CHRONOLOGY.md` + `EVIDENCE.md`, sourced, with gaps | «побудуй хронологію» |
| `procedural-deadlines` | `DEADLINES.md`, reminders, `.ics` | «до коли подати апеляцію?» |
| `procedural-drafting` | draft claims, appeals, motions, requests | «склади апеляційну скаргу» |
| `pre-filing-check` | audit every citation, fact, deadline, attachment | «перевір перед поданням» |
| `case-monitor` | new ЄДРСР decisions; did a law we rely on change? | «що нового у справі?» |
| `client-explainer` | plain Ukrainian, hearing preparation | «що означає ця ухвала?» |

Plus **10 MCP tools** over the official sources: `rada_*` for legislation via the
[data.rada.gov.ua open-data API](https://data.rada.gov.ua/open/main/api/page3), `lpd_*` for Supreme Court
legal positions, `edrsr_*` for the state register of court decisions. Every answer carries `source_url`,
`retrieved_at` and, for law text, the redaction date it belongs to. An empty result says **where and how it
searched** — never "this does not exist".

## The case folder is the product

Case materials and personal data **never** go in this repository. They live in a separate private folder,
which is also what the client and advocate share:

```
CASE.md  INDEX.md  CHRONOLOGY.md  EVIDENCE.md  DEADLINES.md  LOG.md
00_inbox/  01_documents/  02_court/  03_research/  04_drafts/  05_filed/
```

`/ua-case-assistant:setup` creates it and drops in [its `CLAUDE.md`](plugins/ua-case-assistant/skills/setup/references/case-folder-CLAUDE.md), which ships inside the plugin.

## Two things it deliberately will not do

- **Case status is manual.** `court.gov.ua/fair` — the only source of procedural status and hearing dates —
  is behind a reCAPTCHA, and its search fires no request until the CAPTCHA is solved. The plugin gives the
  client or advocate step-by-step instructions instead of pretending to automate it.
- **Nothing is signed, filed or sent.** By design, not by omission.

## Why it quotes the law correctly

The legislation tools read the Rada's **official open-data API**, which publishes its own rate limits and
states that anonymous API access is unrestricted. That gives structured facts a scraper has to guess at, and
it closes several traps that otherwise produce a confident, wrong citation:

- An **archived twin** of a code still reports status «Чинний» while containing repealed penalties. The API
  exposes `is_archive` as a flag, so the twin is rejected rather than parsed out of a title.
- **Superscript article numbers print as plain digits**: ст. 48¹ and ст. 481 are both «Стаття 481.» in the
  text export, and four such collisions exist in the Civil Code alone. The tool returns *all* matches with
  their chapters and flags the ambiguity — it never silently picks one.
- An **excluded article keeps no heading**, only a marker that lands inside the previous article's text, and
  11 of those markers are spelled with a Latin "C". Both are handled, so a live article is not reported as
  repealed nor a repealed one as live.
- **Adopted-but-not-yet-effective redactions** are surfaced, including those that take effect on an event
  rather than a date.

Details and the live measurements behind each claim: [`docs/research-findings.md`](docs/research-findings.md)
and [`mcp/ua-legal-sources/README.md`](mcp/ua-legal-sources/README.md).

## Network etiquette

These are public state sources and the politeness limits are part of the contract, enforced in code rather
than left to the model: targeted requests only, never bulk crawling, the pause data.rada asks for between
requests, ≥1.1 s between ЄДРСР requests, one search plus at most eight documents per question, a full stop on
any CAPTCHA or block page. ЄДРСР documents are **never** written to disk, because the register fixes
personal-data leaks by re-masking the same document id — a cache would keep serving withdrawn data. `ОСОБА_N`
is never de-anonymised or linked across documents.

## Development

```bash
cd mcp/ua-legal-sources && npm install
npm test              # 69 unit tests on recorded fixtures, no network
npm run check-config  # the repo's dev .mcp.json launches the server
npm run build         # rebuild the bundle the plugin ships
npm run check-plugin  # the BUNDLED plugin server, spawned as a client would
npm run smoke         # 9 live checks; spends real requests — run deliberately
claude plugin validate ./plugins/ua-case-assistant
```

The server's source is `mcp/ua-legal-sources/`; the plugin ships a committed bundle at
`plugins/ua-case-assistant/mcp/ua-legal-sources.mjs`. **Run `npm run build` after changing `src/`** —
`npm run check-plugin` fails if the bundle is older than the source.

## Licence and credits

Apache-2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).

Request details for ЄДРСР and the Supreme Court positions database are ported from
[LEXERY Ukrainian Law](https://github.com/LEXERY-AI/lexery-ukrainian-law) (Apache-2.0); their measured traps
are why those modules look the way they do. Legislation excerpts in the test fixtures are open data from the
Verkhovna Rada portal under CC BY 4.0.
