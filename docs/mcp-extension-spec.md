# Spec: local MCP server for Ukrainian legal sources (`ua-legal-sources`)

Status: not started. Goal of the next Claude Code session.

## Why
Claude's web fetch refuses zakon.rada.gov.ua / data.rada.gov.ua (robots.txt), and Cowork's cloud shell is
blocked from court.gov.ua hosts. A stdio MCP server running on the user's Mac uses the Mac's own network and
exposes clean tools to Cowork (via the desktop bridge) and to Claude Code.

## Decisions (proposed; confirm with Ruslan)
| Topic | Proposal |
|---|---|
| Runtime | Node.js + TypeScript, `@modelcontextprotocol/sdk`, stdio. Node ships with Claude Desktop. |
| Packaging | `.mcpb` via `npm i -g @anthropic-ai/mcpb`, `mcpb init`, `mcpb pack`. Also usable in Claude Code via `claude mcp add` or the plugin's `.mcp.json`. |
| Legislation source | Official open-data API on data.rada.gov.ua first. zakon.rada.gov.ua page reads only as targeted, per-question fallback (LEXERY's approach) — **Ruslan to decide**, given robots.txt `Disallow: /`. |
| Reference logic | Port from LEXERY scripts (Apache-2.0, credit them): `skills/ukrainian-legislation/scripts/rada.py`, `skills/ukrainian-court-practice/scripts/edrsr.py`, `.../lpd.py`. |
| Caching | None for ЄДРСР (re-masking fixes leaks under the same id). Short in-memory cache OK for rada/LPD metadata. |
| State | Stateless; per-process rate limiter and per-question budget. |

## Tools (MVP)
| Tool | Input | Output | Backend |
|---|---|---|---|
| `rada_resolve` | `name` (e.g. "КУпАП", "Про судовий збір") | candidates: nreg, title, status, redaction date, archive flag | zakon.rada `/laws/find/a?text=` 302 or data.rada metadata |
| `rada_status` | `nreg` | title, number, date, status, current redaction, future redaction warning | data.rada `/laws/show/<nreg>.json` |
| `rada_text` | `nreg`, optional `unit` (`st130`, `pr_1`…), optional `date` (YYYY-MM-DD) | verbatim text + redaction date + URL | data.rada `.txt`; unit/date addressing TBD (see open questions) |
| `lpd_search` | `query`, `semantic` (bool), `categories?` | positions: id, title, text, categories, URL | POST `/api/v1/search/text` `{query, aiEnabled, categoryArray}` |
| `lpd_position` | `id` | full position + linked document | GET `/api/v1/legal-position/<id>`, `/document/<id>` |
| `lpd_digest_search` | `query` | digest title, page, snippet, PDF URL | POST `/api/v1/digest/search` |
| `edrsr_search` | `expression?`, `case_number?`, `reg_number?`, `judge?`, `court_code?`, `date_from?`, `date_to?` | up to 100 rows: id, form, dates, case №, court, judge | POST `https://reyestr.court.gov.ua/` form |
| `edrsr_document` | `id`, `mode` (`head`/`operative`/`grep:<word>`) | text slice + URL | GET `/Review/<id>` |
| `case_status` | `case_number`, `party?` | stage, last event, hearings | court.gov.ua/fair — endpoint TBD (inspect in browser devtools) |

Every result carries `source_url`, `retrieved_at`, and for law texts the `redaction_date`.
Every empty result says where and how it searched; never "does not exist".

## Endpoint notes
**data.rada.gov.ua** (per Legal Data Hunter's source docs — verify live):
- `GET https://data.rada.gov.ua/laws/show/<nreg>.json` (metadata), `.txt` (full text)
- Header `User-Agent: OpenData`
- Limits: 60 req/min, 100k/day, 200 MB/day; recommended 5–7 s delay for bulk. License CC BY 4.0.

**zakon.rada.gov.ua** (per LEXERY, verified by them 2026-09-02):
- Resolver `/laws/find/a?text=<name>` → 302 Location with nreg list; descriptions return a date-sorted list (trap).
- Archive twins: titles containing «(редакції до …)» are archives with status «Чинний». Reject.
- Unit: `/laws/show/<nreg>/conv/para<tree-id>/only.frame`; tree-ids from `data-tree` attrs in `/stru.frame`.
- Redaction on a date: `/laws/show/<nreg>/ed<YYYYMMDD>`. Card: `/laws/card/<nreg>`.
- Server gzips even without Accept-Encoding; empty User-Agent → 400; JSON card needs `User-Agent: OpenData`.
- Constitution nreg `254к/96-вр` → encode segments, keep the slash.

**lpd-api-prod.court.gov.ua/api/v1** (GETs verified 2026-09-20; POSTs per LEXERY):
- No auth. `/digest/documents` requires a token — skip.

**reyestr.court.gov.ua** (per LEXERY `edrsr.py`):
- Search is POST `/` form (`SearchExpression`, `CaseNumber`, `RegNumber`, `ChairmenName`, `UserCourtCode`,
  `RegDateBegin`, `RegDateEnd`, `PagingInfo.ItemsPerPage=100`). GET `/Page/1?CaseNumber=` returns 200 with zero
  rows — never trust it.
- Browser-like UA, `Accept-Language: uk-UA`, `Referer: https://reyestr.court.gov.ua/`, `Origin` on POST.
  Bare requests hang silently.
- Politeness: one request at a time, ≥1.1 s apart; ≤1 search + ≤8 documents per user question. A hang after
  successful requests = soft rate limit (cooldown), not "no case". Block page → stop and tell the user.
  Do not match on "captcha": the modal is inlined in every page.
- Query grammar: space = AND, `OR`/`NOT` uppercase, `"phrase"`, `word*` prefix (needed for Ukrainian
  morphology), stop words (ОСОБА, АДРЕСА, грн…) are ignored; counts cap at 100 000.
- Anonymization: never carry leaked personal data into answers; never link `ОСОБА_N` across documents.

## Test plan
1. Unit tests on recorded fixtures (HTML/JSON) for parsers: resolver 302, archive-twin filter, `stru.frame`
   tree-ids, ЄДРСР result rows, zero-result vs block page, LPD JSON.
2. Live smoke test on the Mac (one call per tool, spaced out): `rada_status 435-15`, `rada_text 435-15 st1270`,
   `lpd_search "поновлення на роботі"`, `edrsr_document 124629922 head`, `edrsr_search case_number=522/2588/23`.
3. Install the `.mcpb` in Claude Desktop, then confirm the tools appear in a Cowork session.
4. Wire into `plugins/ua-case-assistant` skills (`ua-law-research`, `case-monitor`) as the preferred path.

## Open questions
- Does data.rada.gov.ua expose historical redactions (`ed<date>`) and unit-level text via the open-data API,
  or only current full text?
- Is a token required for higher limits on data.rada.gov.ua?
- court.gov.ua/fair backend endpoint and whether it has CAPTCHA.
- Opendatabot API (paid) as an alternative backend for case status + push notifications?
- Remote (hosted) variant for 24/7 monitoring: host in EU/UA, auth via secret or OAuth.
