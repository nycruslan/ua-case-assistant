#!/usr/bin/env python3
"""Create an .ics calendar file from the DEADLINES.md table.

Usage: python3 make_ics.py DEADLINES.md deadlines.ics

Reads markdown table rows whose first cell starts with a date and whose status is
not "ВИКОНАНО", and writes one all-day event per deadline with alarms 7 and 2
days before. Standard library only; Python 3.8+.

The date may be written as 2026-10-05 or 05.10.2026, and may be followed by a
note such as "(понеділок)". A row whose date cannot be read is reported and
skipped, never silently dropped: in a deadlines table a missing row is a missed
deadline.

Event UIDs are derived from the deadline itself, not random, so re-importing an
updated file updates the existing events instead of duplicating every one.

Exit codes: 0 every row written; 1 some rows skipped (the file is still written
for the rest); 2 nothing written (bad arguments, unreadable input, no rows).
"""
import re
import sys
import uuid
from datetime import date, datetime, timedelta, timezone

ISO = re.compile(r"^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)")
# No procedural deadline lies this far out: a year past it is a typo («2926»,
# «9999»), and 9999-12-31 overflowed the date range and lost the whole calendar.
LAST_PLAUSIBLE_YEAR = 2100
UKR = re.compile(r"^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)")
UID_NAMESPACE = uuid.UUID("5b0f7c1e-3f2a-4c55-9d7e-6a1b2c3d4e5f")


def esc(text: str) -> str:
    """RFC 5545 TEXT escaping."""
    return (text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
            .replace("\n", "\\n"))


def fold(line: str) -> str:
    """Fold to 75 octets per physical line without splitting a UTF-8 character."""
    if len(line.encode("utf-8")) <= 75:
        return line
    parts, cur = [], b""
    for ch in line:
        b = ch.encode("utf-8")
        if len(cur) + len(b) > (75 if not parts else 74):
            parts.append(cur.decode("utf-8"))
            cur = b""
        cur += b
    parts.append(cur.decode("utf-8"))
    return "\r\n ".join(parts)


def read_date(cell: str):
    """Return (date, None), (None, reason) for a malformed date, or None if the
    cell does not start with a date at all (a header or separator row)."""
    m = ISO.match(cell)
    if m:
        y, mo, d = (int(g) for g in m.groups())
    else:
        m = UKR.match(cell)
        if not m:
            return None
        d, mo, y = (int(g) for g in m.groups())
    if y > LAST_PLAUSIBLE_YEAR:
        return None, f"{cell.strip()!r}: рік {y} — схоже на помилку набору"
    try:
        return date(y, mo, d), None
    except ValueError as e:
        return None, f"{cell.strip()!r}: {e}"


def parse(path: str):
    rows, skipped = [], []
    with open(path, encoding="utf-8") as fh:
        for n, line in enumerate(fh, 1):
            if not line.strip().startswith("|"):
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if not cells:
                continue
            parsed = read_date(cells[0])
            if parsed is None:
                continue
            when, problem = parsed
            if problem:
                skipped.append(f"рядок {n}: некоректна дата {problem}")
                continue
            status = cells[5] if len(cells) > 5 else ""
            if "ВИКОНАНО" in status.upper():
                continue
            rows.append({
                "date": when,
                "action": cells[1] if len(cells) > 1 and cells[1] else "Строк",
                "basis": cells[2] if len(cells) > 2 else "",
                "trigger": cells[3] if len(cells) > 3 else "",
                "who": cells[4] if len(cells) > 4 else "",
                "status": status,
            })
    return rows, skipped


def assign_uids(rows) -> None:
    """Give every row a UID that is stable across runs and unique in the file.

    The date is deliberately left out, so a recalculated date UPDATES the event on
    re-import instead of adding a second one beside the stale one. But two real
    deadlines can share action, basis and trigger — two steps from one ruling —
    and identical UIDs make a calendar keep only one of them. Those are numbered
    in date order, which stays stable while the table does.
    """
    groups = {}
    for r in rows:
        groups.setdefault((r["action"], r["basis"], r["trigger"]), []).append(r)
    for key, members in groups.items():
        members.sort(key=lambda r: r["date"])
        for i, r in enumerate(members):
            name = "\x1f".join(key) + (f"\x1f#{i}" if len(members) > 1 else "")
            r["uid"] = f"{uuid.uuid5(UID_NAMESPACE, name)}@ua-case-assistant"


def build(rows) -> str:
    assign_uids(rows)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ua-case-assistant//deadlines//UK",
           "CALSCALE:GREGORIAN"]
    for r in rows:
        desc = (f"Підстава: {r['basis']}\nТригер: {r['trigger']}\nХто діє: {r['who']}\n"
                f"Статус: {r['status']}\nПеревірте строк з адвокатом.")
        out += [
            "BEGIN:VEVENT",
            f"UID:{r['uid']}",
            f"DTSTAMP:{stamp}",
            f"DTSTART;VALUE=DATE:{r['date'].strftime('%Y%m%d')}",
            f"DTEND;VALUE=DATE:{(r['date'] + timedelta(days=1)).strftime('%Y%m%d')}",
            fold(f"SUMMARY:{esc('СТРОК: ' + r['action'])}"),
            fold(f"DESCRIPTION:{esc(desc)}"),
        ]
        for days in (7, 2):
            out += ["BEGIN:VALARM", "ACTION:DISPLAY",
                    fold(f"DESCRIPTION:{esc(f'Через {days} дн.: ' + r['action'])}"),
                    f"TRIGGER:-P{days}D", "END:VALARM"]
        out.append("END:VEVENT")
    out.append("END:VCALENDAR")
    return "\r\n".join(out) + "\r\n"


def die(message: str):
    print(message, file=sys.stderr)
    sys.exit(2)


def main():
    if len(sys.argv) != 3:
        die("Використання: make_ics.py DEADLINES.md output.ics")
    src, dst = sys.argv[1], sys.argv[2]
    try:
        rows, skipped = parse(src)
    except FileNotFoundError:
        die(f"Файл не знайдено: {src}")
    except UnicodeDecodeError:
        die(f"{src} не в кодуванні UTF-8.")

    for s in skipped:
        print(f"⚠ ПРОПУЩЕНО — {s}. Виправ дату в DEADLINES.md.", file=sys.stderr)

    today = date.today()
    for r in sorted(rows, key=lambda r: r["date"]):
        if r["date"] < today:
            print(f"⚠ ПРОСТРОЧЕНО: {r['date'].isoformat()} — {r['action']} "
                  f"(статус «{r['status'] or 'не вказано'}»). Скажи людині негайно.",
                  file=sys.stderr)

    if not rows:
        die("Відкритих строків із датою в таблиці не знайдено.")

    try:
        with open(dst, "w", encoding="utf-8", newline="") as fh:
            fh.write(build(rows))
    except OSError as e:
        die(f"Не вдалося записати {dst}: {e.strerror}")
    print(f"Записано подій: {len(rows)} → {dst}")
    sys.exit(1 if skipped else 0)


if __name__ == "__main__":
    main()
