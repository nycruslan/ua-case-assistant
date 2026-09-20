# Handoff: Ukrainian legal case assistant → Claude Code

Handed off from a Claude Cowork session on 2026-09-20. This folder is everything needed to continue.

## 1. Where things are

| Thing | Location |
|---|---|
| Plugin `ua-case-assistant` v0.1.1 (source) | `plugins/ua-case-assistant/` in this folder |
| Same plugin as installable file (v0.1.0) | `ua-case-assistant.plugin` attached in the Cowork chat; already installed in Cowork |
| Local marketplace for Claude Code | `.claude-plugin/marketplace.json` (name: `ua-legal`) |
| Setup guide (living doc, shareable) | https://claude.ai/code/artifact/28384751-7039-4087-adf1-a33014179ce2 |
| Verified facts + sources | `docs/research-findings.md` |
| Next build: local MCP server spec | `docs/mcp-extension-spec.md` |
| CLAUDE.md for the private case folder | `templates/case-folder-CLAUDE.md` |

v0.1.1 only adds Claude Code notes (local network, `/schedule` caveat); no need to reinstall in Cowork.

## 2. Quick start on the Mac

```bash
unzip ~/Downloads/ua-legal-workspace.zip -d ~        # creates ~/ua-legal-workspace
cd ~/ua-legal-workspace
claude
```

Inside Claude Code:

```
/plugin marketplace add ./
/plugin install ua-case-assistant@ua-legal
/plugin marketplace add LEXERY-AI/lexery-ukrainian-law
/plugin install lexery-ukrainian-law@lexery
/reload-plugins
```

Quick test without installing: `claude --plugin-dir ./plugins/ua-case-assistant`.
Browser access (for zakon.rada.gov.ua and court portals): start with `claude --chrome` or run `/chrome`.
Validate after edits: `claude plugin validate ./plugins/ua-case-assistant`.

For actual case work, use a separate private folder (not this repo):

```bash
mkdir -p ~/Cases/<case-name> && cp templates/case-folder-CLAUDE.md ~/Cases/<case-name>/CLAUDE.md
cd ~/Cases/<case-name> && claude       # then: /ua-case-assistant:case-setup
```

## 3. Decisions made

| Topic | Decision |
|---|---|
| Users | Client (non-lawyer) and their Ukrainian advocate, together |
| Case areas | Civil/family/property; criminal and administrative offenses; commercial |
| Language | Ukrainian for everything the agent produces |
| Architecture | Shared synced case folder as source of truth (`CASE.md` etc.); each person runs their own Claude |
| Research stack | LEXERY plugin (method) + browser (access) + `ua-case-assistant` (workflow) |
| Hard rules | No norm/decision from memory; human signs and files; conservative deadlines; `pre-filing-check` before anything leaves the folder |
| Not used | Anthropic's US-centric legal plugins; Legal Data Hunter for Ukrainian law (thin coverage); unverified Ukrainian MCP servers |

## 4. Key constraints discovered (tested 2026-09-20)

- zakon.rada.gov.ua and data.rada.gov.ua: Claude web fetch refuses them (robots.txt `Disallow: /`).
- Cowork cloud shell: 403 at proxy for reyestr.court.gov.ua, lpd-api-prod.court.gov.ua, court.gov.ua.
- Claude web fetch works for ЄДРСР `/Review/<id>` and LPD API GETs.
- Claude Code on the Mac has normal network: LEXERY scripts and a local MCP server can reach these hosts.
- Cowork's custom egress allowlist is reported broken (claude-code issues #93512 and others).

## 5. Next tasks (in order)

1. **Build the local MCP server** per `docs/mcp-extension-spec.md` (TypeScript, stdio, `.mcpb`). Start with LPD
   and ЄДРСР tools (lowest policy risk), then data.rada.gov.ua open-data tools.
2. **Decide the zakon.rada.gov.ua policy** (open question in the spec): open-data API only, or also targeted
   page reads like LEXERY.
3. **Live smoke test** from the Mac (spec §Test plan), respecting rate limits.
4. **Package `.mcpb`**, install in Claude Desktop, confirm the tools appear in Cowork.
5. **Wire the tools into the plugin**: prefer them in `ua-law-research` and `case-monitor`; bump version.
6. Optional: `claude plugin eval` test prompts for the 9 skills; hosted variant for 24/7 monitoring;
   Opendatabot API if the advocate's firm wants push notifications.

## 6. Open questions for Ruslan

- Do the client and advocate work on separate computers (assumed) or share one?
- zakon.rada.gov.ua page reads: allowed as targeted per-question fallback, or open-data API only?
- Is a paid Opendatabot API worth it for case alerts?

## 7. First prompt to paste into Claude Code

```
Read HANDOFF.md, CLAUDE.md and docs/mcp-extension-spec.md. Then build the MVP local MCP server
described in the spec under ./mcp/ua-legal-sources (TypeScript, stdio, @modelcontextprotocol/sdk).
Start with lpd_search, lpd_position, edrsr_search and edrsr_document, porting request details from
LEXERY's lpd.py and edrsr.py (credit them, Apache-2.0). Write fixture-based tests first, then run the
live smoke test from this Mac, one request at a time and within the politeness limits. Ask me before
implementing any zakon.rada.gov.ua page fetching.
```
