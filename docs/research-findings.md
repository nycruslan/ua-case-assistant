# Research findings (as of 2026-09-20)

## Tested from a Cowork cloud session on 2026-09-20

| Target | Claude web fetch | Cowork cloud shell (curl) | Note |
|---|---|---|---|
| zakon.rada.gov.ua (any path, incl. robots.txt) | Refused: robots.txt disallow | Not attempted (policy) | robots.txt is `Disallow: /` for all agents (per LEXERY docs) |
| data.rada.gov.ua | Refused (robots.txt / connect timeout) | Not attempted (policy) | Official open-data API; see spec |
| reyestr.court.gov.ua `/` and `/Review/124629922` | OK (decision 522/2588/23, 17.01.2025) | 403 at proxy CONNECT | ~137.7M docs; "test (limited) mode" banner |
| lpd-api-prod.court.gov.ua `/api/v1/court/list` | OK (JSON, 5 cassation courts) | 403 at proxy CONNECT | No auth for GETs |
| lpd.court.gov.ua | Empty JS shell | — | SPA; use the API |
| court.gov.ua/fair/ | Page loads; search is a form | 403 at proxy CONNECT | Case status |
| id.court.gov.ua (Електронний суд) | Login page | — | id.gov.ua, Дія.Підпис, cloud signature |
| hudoc.echr.coe.int | Inconclusive (JS app) | — | |

Implication: in Cowork, only the browser (Claude in Chrome / built-in browser) or a local MCP server on the
user's machine can reach these sources reliably. In Claude Code on the user's Mac, the shell has normal network.

## Tested from Claude Code on the Mac, 2026-09-20 (session 2)

The Mac has normal network to every source. All of the below is from live requests, not docs.

| Target | Result | Note |
|---|---|---|
| `data.rada.gov.ua/laws/show/<nreg>.json` | 200 | Structured card. `is_archive`, `status`, `datred`, `pidstava`, `edcnt`, `eds[]`, `history` |
| `data.rada.gov.ua/laws/card/<nreg>` | 200, ~2.7 KB | Carries the status **word** («Стан: Чинний»), so a numeric code never has to be guessed |
| `data.rada.gov.ua/laws/show/<nreg>.txt` | 200 | Full text. ЦК 1 791 233 B, КУпАП 1 798 791 B |
| `data.rada.gov.ua/laws/show/<nreg>/ed<YYYYMMDD>.txt` | 200 | **Historical redaction works through open data.** ЦК ed20250101 = 1 717 330 B vs current 1 791 233 B |
| `data.rada.gov.ua/laws/show/<nreg>/st<N>.txt` | 404 | No unit-level addressing — slice locally from the cached `.txt` |
| `data.rada.gov.ua/laws/main/r.tsv` | 200, ~240 KB | Machine-readable feed of **recently updated** acts. Useful for monitoring; the whole-corpus list (`/laws/main/a`) is HTML only |
| `data.rada.gov.ua/laws/find/a?text=…` | 200, empty | The resolver does **not** exist on data.rada — only on zakon.rada |
| `zakon.rada.gov.ua/laws/card/435-15` with `User-Agent: OpenData` | **403** | The spec said this UA was needed here; for HTML it is refused |
| same with a browser UA | 200 | So the UA is per-host, not global |
| `zakon.rada.gov.ua/laws/find/a?text=КУпАП` | 302 → `/laws/main/8073-10,80731-10,80732-10` | The `Location` header IS the answer; no body needed |
| `lpd-api-prod.court.gov.ua/api/v1/search/text` | 200, 50 positions | No auth |
| `reyestr.court.gov.ua/` POST `CaseNumber=522/2588/23` | 200, 18 rows, 3 instances | Full case history in one POST |
| `reyestr.court.gov.ua/Review/124629922` | 200, 48 492 chars | «test (limited) mode» banner present |
| `court.gov.ua/fair/` search | **reCAPTCHA v2** | See below |

### data.rada is an officially sanctioned API — this settles the robots.txt question
`robots.txt` on **both** rada hosts is `User-Agent: * → Disallow: /`. But the portal publishes API
documentation that states plainly: «Доступ до API відбувається анонімно без обмежень», and if the
infrastructure blocks an IP, you ask the administrator to whitelist it. Documented limits, now honoured
in code: 60 req/min (with a **requested random 5–7 s pause**), 100 000 req/day, 200 MB/day, 800 000
pages/day; `User-Agent: OpenData` for anonymous access; `Last-Modified`/`If-Modified-Since` to cut traffic
(verified: a conditional GET returns 304). Requesting a token or checking limits **before every request is
forbidden** — such IPs get blocked.
→ Decision taken: data.rada for everything; zakon.rada for the resolver 302 only.

### court.gov.ua/fair is CAPTCHA-gated — automated case status is not possible
Inspected in the browser. The page loads reCAPTCHA v2 (explicit render, sitekey
`6LdIjOQSAAAAAA5VkX2tOq9Znrem2-r_WZi6Jetn`, anchor + bframe iframes). The search form fields are
`n_case`, `n_proc`, `q_srch`, `region`, `court`, `sdate`, `edate`, `srch`, with a `#search` button.
Clicking `#search` programmatically produced **zero network requests** — the handler aborts until the
CAPTCHA is solved. Bypassing it is out of scope and against this project's own rules.
→ Case status stays a human step. Monitoring *published decisions* by ЄУН through ЄДРСР still works.

### Traps in the law text itself (found by reading the live ЦК, 2026-09-20)
Each of these produced a confidently WRONG norm, which is the worst failure mode for this tool.
- **Superscript article numbers print as plain digits.** ст. 48¹ and ст. 481 are both «Стаття 481.» in the
  `.txt`, and the superscript is unrecoverable. In ЦК four numbers collide this way (481, 961, 991, 1051),
  each pair being two unrelated norms. Any tool that keeps the first match will silently cite the wrong one.
- **An excluded article keeps no heading**, only the marker `{Статтю 501 виключено…}` — which therefore sits
  inside the slice of ст. 50. Matching the marker without comparing article numbers flagged **6 in-force
  articles of ЦК as repealed**.
- **11 of 179 exclusion markers spell «Cтаттю» with a LATIN C** (U+0043) instead of Cyrillic С. A
  Cyrillic-only pattern misses them, so an excluded article reads as live together with its repealed text.
- **Partial exclusions are not article exclusions**: «Частину четверту статті 32 виключено» (50 of them in
  ЦК) must not be read as the article being gone. Anchoring the pattern to `{` separates them.
- **«Глава 4» is a prefix of «Глава 41».** Prefix matching on structural headings produces false ambiguity
  between unrelated chapters.
- Byte size is not character count: ЦК is 1 791 233 bytes but 995 799 characters (Cyrillic is 2 bytes in
  UTF-8). Do not read a size change as a content change.

### Found by an adversarial user-level stress test (2026-09-21)
Every item below produced a wrong or misleading answer from a live source, and each is now pinned by a test.
- **`/ed<date>` never refuses a date.** data.rada answers ЦК as of 1990-01-01 — thirteen years before it was
  adopted — with HTTP 200 and today's text, byte for byte. The act's own `history` must decide what existed.
  For a valid date the text returned is the redaction *in force* then (as of 2015-01-01 → the 2014-11-06
  redaction), so the requested date must never be echoed back as the redaction date.
- **The year-3000 sentinel is a family**: КУпАП carries 30000101, 30000102 and 30000103 for several pending
  event-conditional redactions; ЦК carries only 30000101.
- **ЦК names its books in words** («КНИГА П'ЯТА»), and «Розділ I» recurs in three different books. Users type
  «Книга 5», «Розділ 1», and any of four apostrophes.
- **ЄДРСР `/Review/<id>` with no decision** answers HTTP 200 with the bare site shell (~6 KB). A real decision
  page always carries `id="txtdepository"` / `id="divdocument"`. The register also restricts some real
  decisions, so a missing container never means "does not exist".
- **ЄДРСР answers HTTP 500 to anything HTML-shaped** in a search field («поновлен* <b>»). Quotes are fine.
- **ЛПД's lexical search never returns zero.** Gibberish («qwzx») returns ten real Supreme Court positions on
  unrelated subjects, a different ten each time. The only signal is that none of them contain a query word.
- **Claude Code caps an MCP tool result at 25 000 tokens** (warning at 10 000; `MAX_MCP_OUTPUT_TOKENS`).
  Cyrillic runs ~2.5 characters per token, so a whole Книга of ЦК (489 551 chars) must be bounded server-side.
- **Tool parameters are JSON.** Writing a regex such as `\u200B` through an editing tool decodes it into the
  invisible character itself — that is how a raw NUL once made a source file register as binary `data`.
  Build such characters from code points instead.

### Found by the second stress round (2026-09-21)
- **ЄДРСР silently ignores a date it cannot parse.** `31/02/2024` returned all 18 rows of a case, unfiltered,
  which looks exactly like a filtered result. Dates are now calendar-checked (ISO accepted, converted to
  DD.MM.YYYY) and a reversed range is refused.
- **Unbounded arguments are a real cost.** A 13 000-character law name held zakon.rada for 57 s until the
  socket dropped; tools that echo input turned a 20 000-character case number into ~8k tokens. Every free-text
  argument now has a ceiling far above any real value.
- **Errors in the model's own input must say so.** They were labelled `http`, so the reminder read "the source
  did not answer" and sent the model looking for an outage. They are now kind `input`.
- **A corrupted cache entry crashed the resolver** instead of refetching. Cache entries are shape-checked.
- **`make_ics.py`: `9999-12-31` overflowed `date` and lost the whole calendar**, and two deadlines with the same
  action, basis and trigger got one UID, so a calendar kept only one. Years past 2100 are skipped and reported;
  repeated rows are numbered in date order.

### Engineering findings that cost real debugging time
- **Superseded diagnosis, kept as a warning:** roughly a third of Node requests to data.rada died with
  `ECONNRESET` while curl never failed. It was first blamed on connection pooling, and a fresh
  `undici.Agent` per request appeared to help — but only by chance. The real cause is TLS 1.3 (see «THE root cause»
  below). `Connection: close`, pinning `Accept-Encoding` and ALPN made no difference. If resets return,
  check the negotiated TLS version before anything else.
- **`Accept-Encoding: identity` gets the connection reset** by data.rada. Leave encoding to the default.
- **JavaScript `\b` is ASCII-only**, so `/^(Розділ|Глава)\b/` matches nothing after a Cyrillic letter.
  Silent failure: articles still resolve, structural units just become unreachable.
- **`status` is identical (5) on a code and its archived twins.** Only `is_archive` separates them, which
  makes the structured flag strictly better than parsing «редакції до» out of the title.
- **`history` ends with the sentinel `30000101`** — not the year 3000, but an adopted amendment whose
  entry into force depends on an event («відбудеться пізніше»). ЦК has exactly one, basis `3153-20`.
- **THE root cause of every connection failure: the rada hosts are TLS 1.2-only and drop a TLS 1.3
  handshake instead of negotiating down.** `data.rada.gov.ua` is a CNAME of `zakon.rada.gov.ua` — one server,
  193.19.153.66 — and a bare TLS probe shows it: default (1.3 offered) = ECONNRESET, `maxVersion: TLSv1.2` =
  OK. Node offers 1.3 by default, so requests fail intermittently with ECONNRESET or "Client network socket
  disconnected before secure TLS connection was established", while curl, which lands on 1.2, never fails.
  The court hosts (`reyestr`, `lpd-api-prod`) negotiate 1.3 fine, so the cap is applied per host. This had
  been misdiagnosed as connection pooling: disabling the pool masked it, it did not fix it.
- Transport errors (only those) are retried up to three times with 2 s and 5 s backoff. A soft rate limit is
  never retried — retrying is what deepens it.
- **A documented politeness rule has to be enforced, not assumed.** «One request at a time» needs an actual
  per-host queue: a delay alone does not stop two concurrent callers reading the same timestamp and firing
  together.
- **An MCP client spawns a server without a login shell**, so `node` is absent from PATH when it comes from a
  version manager. A `.mcp.json` with `"command": "node"` fails with ENOENT, and `"type": "stdio"` is read as
  the executable name. Launch through a small shell script that resolves the interpreter itself.

## Claude product facts (official docs, 2026)
- Plugins: Pro/Max/Team/Enterprise; install via Customize > Plugins (marketplace, upload, GitHub). Hooks and
  sub-agents only in Cowork. Local MCP servers in plugins run on the user's computer.
- Cowork projects: instructions, context folders, project-scoped memory, scheduled tasks. Sharing only on
  Team/Enterprise. Locally created projects don't sync.
- Cowork runs in Anthropic cloud; files/browser/computer use need Claude Desktop open.
- "Network egress permissions don't apply to the web fetch or web search tools or MCPs."
- Custom connectors (remote MCP): Customize > Connectors > Add custom connector; server must be reachable from
  Anthropic's IP ranges.
- Desktop extensions (.mcpb): one-click local MCP install; Claude Desktop bundles Node.js.
- Consumer privacy: "Help improve Claude" off → 30-day retention, no training; on → 5 years.
- Cowork egress allowlist bugs: anthropics/claude-code issues #93512, #38984, #30112, #33386, #51400.

## Ukrainian legal-AI landscape
- LEXERY Ukrainian Law plugin (github.com/LEXERY-AI/lexery-ukrainian-law): v1.0.0, 2026-09-03, Apache-2.0,
  one commit. 3 skills (legislation, court practice, citation audit) + stdlib Python scripts. Code reviewed:
  contacts only zakon.rada.gov.ua, reyestr.court.gov.ua, lpd(-api-prod).court.gov.ua, supreme.court.gov.ua,
  court.gov.ua. No telemetry.
- Anthropic Claude for Legal (May 2026): 12 practice-area plugins, 20+ connectors; US-centric.
- Legal Data Hunter connector: 160–230+ jurisdictions; its public source repo shows Ukraine ingestion mostly
  inactive (RadaLegislation working; SupremeCourt/EDRSR not). HUDOC listed but untested.
- No verifiable Ukrainian-law MCP server found (Ansvar "ukrainian-law-mcp" listed on agentseal.org; GitHub 404).
- Opendatabot ЄДРСР API: paid B2B (application needs ЄДРПОУ); decisions, case info, hearing schedule, case
  status, SC positions, real-time notifications.
- LIGA:ZAKON / LIGA360: no public API; usable via logged-in browser.

## Ukrainian legal context
- Supreme Court on AI misuse: 925/200/22 (08.02.2024, КГС), 925/496/24 (08.07.2025, КГС),
  240/14153/24 (15.01.2026, КАС — fictitious citations).
- Мінцифри/Мін'юст/ДСА recommendations for lawyers on AI (04.08.2025): demand sources, client consent in the
  contract, anonymize personal data, secured/corporate tools, lawyer bears responsibility.
- Martial law extended to 31.10.2026 (decree signed 24.07.2026).
- Commercial Code (ГК) lost force 28.08.2025 (Law № 4196-IX, art. 17).
- New Civil Code bill № 15150 passed first reading 28.04.2026.
- Supreme Court legal positions base: no registration since 01.11.2023.

## Sources
- https://support.claude.com/en/articles/13837440-use-plugins-in-claude
- https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork
- https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork
- https://support.claude.com/en/articles/16761823-claude-cowork-and-chat-are-one-claude
- https://support.claude.com/en/articles/13364135-use-claude-cowork-safely
- https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop
- https://claude.com/docs/connectors/building/mcpb
- https://code.claude.com/docs/en/plugins
- https://github.com/anthropics/claude-for-legal
- https://github.com/LEXERY-AI/lexery-ukrainian-law
- https://github.com/worldwidelaw/legal-sources
- https://opendatabot.ua/open/api-edrsr
- https://unba.org.ua/publications/11425-shi-ta-pravnicha-diyal-nist-yak-reaguyut-sudi.html
- https://supreme.court.gov.ua/supreme/pres-centr/news/1566118/
- https://thedigital.gov.ua/news/technologies/yak-bezpechno-pratsyuvati-z-shi-rekomendatsii-dlya-pravnikiv
- https://supreme.court.gov.ua/supreme/pres-centr/news/1869305/
- https://www.slovoidilo.ua/2026/07/24/novyna/suspilstvo/zelenskyj-pidpysav-ukazy-pro-prodovzhennya-voyennoho-stanu-ta-mobilizacziyi
- https://suspilne.media/1300335-rada-shvalila-u-persomu-citanni-novij-civilnij-kodeks/
- https://github.com/anthropics/claude-code/issues/93512

## Sources added in session 2 (verified live from the Mac)
- https://data.rada.gov.ua/open/main/api — open-data API index («анонімно без обмежень»)
- https://data.rada.gov.ua/open/main/api/page2 — Last-Modified / If-Modified-Since guidance
- https://data.rada.gov.ua/open/main/api/page3 — «Законодавство України» endpoints, limits, token rules
- https://data.rada.gov.ua/robots.txt and https://zakon.rada.gov.ua/robots.txt — both `* → Disallow: /`
