#!/usr/bin/env python3
"""Create an .ics calendar file from the DEADLINES.md table.

Usage: python3 make_ics.py DEADLINES.md deadlines.ics

Reads markdown table rows whose first cell is a date (YYYY-MM-DD) and whose status is not
"ВИКОНАНО". Creates an all-day event per deadline with alarms 7 days and 2 days before.
Standard library only.
"""
import re
import sys
import uuid
from datetime import date, datetime, timedelta, timezone

DATE_RE = re.compile(r"^\s*(\d{4}-\d{2}-\d{2})\s*$")


def esc(text: str) -> str:
    return (text.replace("\\", "\\\\").replace(";", "\;").replace(",", "\\,")
            .replace("\n", "\\n"))


def fold(line: str) -> str:
    raw = line.encode("utf-8")
    if len(raw) <= 75:
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


def parse(path: str):
    rows = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if not line.strip().startswith("|"):
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if not cells or not DATE_RE.match(cells[0]):
                continue
            status = cells[5] if len(cells) > 5 else ""
            if "ВИКОНАНО" in status.upper():
                continue
            rows.append({
                "date": date.fromisoformat(cells[0]),
                "action": cells[1] if len(cells) > 1 else "Строк",
                "basis": cells[2] if len(cells) > 2 else "",
                "trigger": cells[3] if len(cells) > 3 else "",
                "who": cells[4] if len(cells) > 4 else "",
                "status": status,
            })
    return rows


def build(rows) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ua-case-assistant//deadlines//UK",
           "CALSCALE:GREGORIAN"]
    for r in rows:
        desc = (f"Підстава: {r['basis']}\nТригер: {r['trigger']}\nХто діє: {r['who']}\n"
                f"Статус: {r['status']}\nПеревірте строк з адвокатом.")
        out += [
            "BEGIN:VEVENT",
            f"UID:{uuid.uuid4()}@ua-case-assistant",
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


def main():
    if len(sys.argv) != 3:
        sys.exit("Usage: make_ics.py DEADLINES.md output.ics")
    rows = parse(sys.argv[1])
    if not rows:
        sys.exit("No open deadlines with YYYY-MM-DD dates found in the table.")
    with open(sys.argv[2], "w", encoding="utf-8", newline="") as fh:
        fh.write(build(rows))
    print(f"Wrote {len(rows)} event(s) to {sys.argv[2]}")


if __name__ == "__main__":
    main()
