/**
 * Minimal HTML→text helpers.
 *
 * These sources return HTML in three shapes — a rada card page, an ЄДРСР
 * decision page, and inline markup inside LPD's JSON fields — and all three
 * previously had their own near-identical stripper. One implementation, two
 * entry points.
 */

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&quot;": '"',
  "&apos;": "'",
  "&laquo;": "«",
  "&raquo;": "»",
  "&lt;": "<",
  "&gt;": ">",
  "&mdash;": "—",
  "&ndash;": "–",
};

/**
 * Named entities plus numeric ones. The numeric pass matters: court decisions
 * carry things like `&#8470;` (№), and an undecoded entity would be quoted
 * verbatim into a legal document.
 */
function decode(s: string): string {
  return s
    .replace(
      /&(?:nbsp|amp|quot|apos|laquo|raquo|lt|gt|mdash|ndash);/g,
      (m) => ENTITIES[m] ?? m,
    )
    .replace(/&#(\d+);|&#x([0-9a-f]+);/gi, (m, dec: string, hex: string) => {
      const code = dec ? Number(dec) : parseInt(hex, 16);
      // Leave anything outside Unicode, or a lone surrogate, exactly as it came.
      if (!Number.isInteger(code) || code < 32 || code > 0x10ffff) return m;
      if (code >= 0xd800 && code <= 0xdfff) return m;
      return String.fromCodePoint(code);
    });
}

/** Inline markup → plain text on a single line. For text inside JSON fields. */
export function stripTags(html: unknown): string {
  if (typeof html !== "string") return "";
  return decode(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

/**
 * A whole HTML document → plain text, preserving block boundaries as newlines.
 *
 * Each line is trimmed: tags become spaces so words never glue together, which
 * otherwise leaves every line starting with one. That matters downstream — the
 * ЄДРСР operative-part marker is matched per line, and a quoted norm should not
 * carry stray indentation into a legal document.
 */
export function htmlToText(html: string): string {
  let s = html.replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<br\s*\/?>|<\/(?:p|div|tr|li|h[1-6])>/gi, "\n");
  s = decode(s.replace(/<[^>]+>/g, " "));
  return s
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
