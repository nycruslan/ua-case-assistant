# ua-legal-workspace

A Claude setup for a client (non-lawyer) and their Ukrainian advocate working one legal case together:
civil/family/property, criminal and administrative offences, commercial. Everything the agent produces is in
Ukrainian. Started in Claude Cowork on 2026-09-20, developed in Claude Code since.

## Layout
- `plugins/ua-case-assistant/` — the plugin (10 skills, Ukrainian) and the bundled MCP server it ships.
- `.claude-plugin/marketplace.json` — local marketplace `ua-legal`, so the plugin installs in Claude Code.
- `mcp/ua-legal-sources/` — SOURCE of the MCP server (9 tools). **Read its README before changing
  anything**: the per-host TLS cap, request policy, fail-safe archive handling and article-number collision
  handling all encode findings that cost real debugging.
- `plugins/ua-case-assistant/mcp/ua-legal-sources.mjs` — the committed bundle the plugin ships, built from
  that source with `npm run build`. Users need no `npm install`; the plugin declares it in its own
  `.mcp.json` via `${CLAUDE_PLUGIN_ROOT}`.
- `.mcp.json` at the repo root registers the server from source as `ua-legal-sources-dev`, so developing here
  never collides with the plugin's bundled copy.
- `LICENSE` / `NOTICE` — Apache-2.0, plus attribution owed to LEXERY and to data.rada (CC BY 4.0).
- `docs/research-findings.md` — verified facts with sources. Ground truth only where marked tested;
  re-check anything else.
- `plugins/ua-case-assistant/skills/setup/references/case-folder-CLAUDE.md` — the CLAUDE.md for a private case folder. It ships inside the plugin, because the setup skill copies it on a user's machine where this repo does not exist.

## Decisions already made
| Topic | Decision |
|---|---|
| Users | Client and their advocate, working the same case folder |
| Architecture | Shared synced case folder is the source of truth (`CASE.md` etc.); each person runs their own Claude |
| Research stack | `ua-legal-sources` MCP server (access) + LEXERY plugin (method) + `ua-case-assistant` (workflow) |
| Legislation source | data.rada.gov.ua open-data API for everything; zakon.rada only for the name→nreg resolver 302 |
| Case status | Manual: `court.gov.ua/fair` is reCAPTCHA-gated, so it is a human step, never automated |
| Hard rules | No norm or decision from memory; a human signs and files; deadlines conservative; `pre-filing-check` before anything leaves the folder |
| Not used | US-centric legal plugins; Legal Data Hunter for Ukrainian law (thin coverage); unverified Ukrainian MCP servers |

## Rules for working here
- Case documents and personal data never go into this repo (see `.gitignore`). The case folder lives elsewhere.
- Skills are written in Ukrainian; keep them in Ukrainian. Frontmatter descriptions stay English with
  Ukrainian trigger phrases.
- After changing the plugin: `claude plugin validate ./plugins/ua-case-assistant`, bump `version` in both
  `plugin.json` and `marketplace.json`, then `/reload-plugins`.
- After changing the MCP server: `cd mcp/ua-legal-sources && npx tsc --noEmit && npm test`, then
  **`npm run build`** to refresh the bundle the plugin ships, then `npm run check-plugin` (it fails if the
  bundle is older than `src/`). `npm run smoke` hits the live sources and spends real requests — run it
  deliberately, not on every edit. Developing needs Node 24 (the source runs as TypeScript); the shipped
  bundle needs only Node 20.
- Two launcher scripts, both deliberate: `mcp/ua-legal-sources/bin/start.sh` (dev, runs the TypeScript
  source) and `plugins/ua-case-assistant/scripts/ua-legal-sources.sh` (shipped, runs the bundle). An MCP
  client spawns a server without a login shell, so `node` is not on PATH when it comes from a version
  manager. Do not "simplify" either one back to `"command": "node"` — that fails with ENOENT. The shipped
  one lives in `scripts/`, not `bin/`, because a plugin's top-level `bin/` cannot be distributed through
  claude.ai organization settings.
- After changing either `.mcp.json`: `npm run check-config` (dev) and `npm run check-plugin` (shipped).
- Editing the server's source does not affect the running one: Claude Code spawns it at startup, so reload
  the app to pick up changes.
- Never loosen a rate limit or the ЄДРСР no-disk-cache rule to make something faster. Those are the contract
  with these sources, and the reasons are in the code comments.
- Keep every tool result under Claude Code's 25 000-token cap on MCP output (~60 000 Cyrillic chars). Anything
  that can grow — law units, search results, decision text — is bounded in the server and says when it was cut.
- Never write `\uXXXX` escapes through an editing tool: parameters are JSON, so they decode into the raw
  (often invisible) character. Build such characters with `String.fromCharCode` / `chr()`.
- Network etiquette for Ukrainian state sources is part of the contract: targeted requests only, no bulk
  crawling, ≥1.1 s between ЄДРСР requests, stop on CAPTCHA/block pages, never cache ЄДРСР documents, never
  de-anonymize `ОСОБА_N`.
- User preferences: direct, concise, tables for comparisons, one definitive recommendation, honest tradeoffs,
  no over-engineering.

## Setup
Users install from the published marketplace and then run `/ua-case-assistant:setup`, which checks the
sources, offers LEXERY and creates the case folder. See `README.md`.

To develop against this checkout instead of an installed copy:
```bash
claude --plugin-dir ./plugins/ua-case-assistant
```

For real case work use a separate private folder, never this repo:
```bash
mkdir -p ~/Cases/<case-name> && cp plugins/ua-case-assistant/skills/setup/references/case-folder-CLAUDE.md ~/Cases/<case-name>/CLAUDE.md
cd ~/Cases/<case-name> && claude    # then: /ua-case-assistant:setup
```

## Remaining work
- Publish: push to `github.com/nycruslan/ua-case-assistant`, then submit to the community marketplace at
  clau.de/plugin-directory-submission. Tag releases with `claude plugin tag --push`.
- Optional: a `.mcpb` desktop extension is no longer needed for Cowork — Cowork installs the same GitHub
  marketplace, and the bundled server has no dependencies.
- Optional: `claude plugin eval` prompts for the 10 skills. LEXERY's `evals/` is a good model, and two of its
  cases (КУпАП ст.130 archive twin, ст.21 excluded) are already pinned as unit tests here.
- Optional: watch `data.rada.gov.ua/laws/main/r.tsv` (feed of amended acts) so the case is told when a law it
  relies on changes. `case-monitor` step 6 does this manually today.

## Open questions for Ruslan
- Do the client and advocate work on separate computers (assumed) or share one?
- Is a paid Opendatabot API worth it for case alerts? It is now the **only** route to automated case-status
  alerts, since `court.gov.ua/fair` is reCAPTCHA-gated.
