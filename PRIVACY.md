# Політика конфіденційності · Privacy policy

Плагін `ua-case-assistant` і його сервер `ua-legal-sources`. Чинна з 12 жовтня 2026 року.

## Українською

**Автор не отримує жодних даних.** Плагін не має телеметрії, аналітики чи облікових записів і не звертається
до серверів автора. Автор не бачить ні ваших справ, ні ваших запитів.

**Що лишається на вашому комп'ютері.** Тека справи (`CASE.md`, документи, хронологія, докази) — це звичайні
файли у вашій теці. Плагін нікуди їх не надсилає.

**Що надсилається і куди.** Сервер звертається по HTTPS лише до чотирьох офіційних державних джерел:

| Хост | Що надсилається |
|---|---|
| `data.rada.gov.ua` | номер акта, дата редакції |
| `zakon.rada.gov.ua` | назва чи абревіатура акта |
| `lpd-api-prod.court.gov.ua` | текст пошукового запиту |
| `reyestr.court.gov.ua` | пошуковий запит, номер справи чи ЄРДР, прізвище судді, дати |

Запити формує Claude з вашого питання, тож у них може потрапити, наприклад, номер вашої справи. Ці сайти
обробляють запити за власними правилами. Якщо задано `HTTPS_PROXY`, запити йдуть через цей проксі, а логін і
пароль з його адреси надсилаються лише йому.

Якщо сервер недоступний або джерело вимагає людини (капча), скіли просять Claude шукати на офіційних
державних сайтах (`rada.gov.ua`, `court.gov.ua`, інші `*.gov.ua`) його власним браузером і web search. Ці
запити йдуть через інструменти Claude у вашому обліковому записі, а не через плагін.

**Що зберігається.** Тексти законів кешуються на диску (`~/.claude/plugins/data/…/cache` або
`~/.cache/ua-legal-sources`). Судові рішення з ЄДРСР на диск не записуються — лише в пам'яті на час сесії.
Кеш можна видалити будь-коли. Видалення плагіна в Claude Code прибирає `~/.claude/plugins/data/…`; теку
`~/.cache/ua-legal-sources`, якщо вона є, видаляєте ви.

**Сам Claude.** Те, чим ви ділитеся з Claude, зокрема зміст документів справи, обробляє Anthropic за
умовами вашого облікового запису Claude. Плагін цього не змінює і нічого до цього не додає.

**Питання й зміни.** Питання — через [GitHub Issues](https://github.com/nycruslan/ua-case-assistant/issues).
Зміни цієї політики публікуються в цьому файлі разом з історією змін у репозиторії.

## English

**The author receives no data.** The plugin has no telemetry, analytics or accounts and never contacts the
author's servers.

**What stays on your computer.** The case folder (`CASE.md`, documents, chronology, evidence) is ordinary files
in a folder you choose. The plugin sends none of them anywhere.

**What is sent, and where.** The server connects over HTTPS to four official Ukrainian state hosts and nothing
else: `data.rada.gov.ua` (act number, redaction date), `zakon.rada.gov.ua` (act name), `lpd-api-prod.court.gov.ua`
(search text) and `reyestr.court.gov.ua` (search terms, case or ЄРДР number, judge, dates). Claude builds the
queries from your question, so they may include your case number. Those sites handle requests under their own
rules. If `HTTPS_PROXY` is set, requests go through that proxy, and any credentials in its URL go only to it.

When the server is unavailable or a source needs a person (a CAPTCHA), the skills ask Claude to search
official state sites (`rada.gov.ua`, `court.gov.ua`, other `*.gov.ua`) with its own browser and web search.
Those requests go through Claude's tools under your Claude account, not through the plugin.

**What is stored.** Law texts are cached on disk (`~/.claude/plugins/data/…/cache` or
`~/.cache/ua-legal-sources`). Court decisions are never written to disk, only held in memory for the session.
Delete the cache at any time. Uninstalling the plugin in Claude Code removes `~/.claude/plugins/data/…`;
`~/.cache/ua-legal-sources`, if present, is yours to delete.

**Claude itself.** What you share with Claude, including case documents, is processed by Anthropic under the
terms of your Claude account. The plugin neither changes nor adds to that.

**Questions and changes.** Use [GitHub Issues](https://github.com/nycruslan/ua-case-assistant/issues). Changes to
this policy are published in this file, with its history in the repository.
