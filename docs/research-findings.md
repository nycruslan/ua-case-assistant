# Research findings (as of 2026-09-20)

Full guide (living doc): https://claude.ai/code/artifact/28384751-7039-4087-adf1-a33014179ce2

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
