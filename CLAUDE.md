# ua-legal-workspace

Development workspace for a Claude setup that helps a client and their Ukrainian advocate work one legal case
(civil/family/property, criminal/administrative-offense, commercial). Started in a Claude Cowork session on
2026-09-20 and handed off to Claude Code. **Read `HANDOFF.md` first.**

## Layout
- `plugins/ua-case-assistant/` — the plugin (9 skills, Ukrainian). Also installed in the user's Cowork.
- `.claude-plugin/marketplace.json` — local marketplace `ua-legal` so the plugin installs in Claude Code.
- `docs/research-findings.md` — verified facts (tested 2026-09-20) and sources. Treat as ground truth only
  where marked tested; everything else must be re-checked.
- `docs/mcp-extension-spec.md` — spec for the next build: a local MCP server / desktop extension for
  Ukrainian legal sources.
- `templates/case-folder-CLAUDE.md` — CLAUDE.md to drop into the (separate, private) case folder.

## Rules for working here
- Case documents and personal data never go into this repo (see `.gitignore`). The case folder lives elsewhere.
- Skills are written in Ukrainian; keep them in Ukrainian. Frontmatter descriptions stay English with
  Ukrainian trigger phrases.
- After changing the plugin: `claude plugin validate ./plugins/ua-case-assistant`, bump `version` in both
  `plugin.json` and `marketplace.json`, then `/reload-plugins`.
- Network etiquette for Ukrainian state sources is part of the contract: targeted requests only, no bulk
  crawling, ≥1.1 s between ЄДРСР requests, stop on CAPTCHA/block pages, never cache ЄДРСР documents, never
  de-anonymize `ОСОБА_N`.
- User preferences: direct, concise, tables for comparisons, one definitive recommendation, honest tradeoffs,
  no over-engineering.
