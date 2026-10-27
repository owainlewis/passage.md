import { Lexer, type Token } from "marked";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---(?:\n|$)/;

export function bodyWithoutFrontmatter(body: string): string {
  return body.replace(FRONTMATTER_RE, "").replace(/^\n+/, "");
}

export function titleOf(body: string): string {
  for (const raw of bodyWithoutFrontmatter(body).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    return line.replace(/^#{1,6}\s+/, "").replace(/[*_`>#]/g, "").trim() || "Untitled";
  }
  return "Untitled";
}

const NO_SUMMARY = "No additional text";
const SUMMARY_LIMIT = 280;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
// A "text" token only carries child tokens at block level, as in a tight list.
const BLOCKS = new Set(["paragraph", "heading", "blockquote", "list_item", "text"]);

// The words of the document after its title line, for list rows. Markdown is
// parsed rather than pattern-stripped, so links keep their text, images and
// code blocks drop out, and prose containing *, _ or ~ is left alone.
export function snippetOf(body: string): string {
  const rest = bodyAfterTitle(body);
  return rest === null ? NO_SUMMARY : plainSummary(rest);
}

// The Markdown after the title line, or null when there is no title line.
export function bodyAfterTitle(body: string): string | null {
  const lines = bodyWithoutFrontmatter(body).split("\n");
  const titleLine = lines.findIndex((line) => line.trim().length > 0);
  return titleLine === -1 ? null : lines.slice(titleLine + 1).join("\n");
}

// Search excerpts are cut from the title and body together, so they often
// open with the title the row already shows, sometimes with its first words
// cut off. Drop each copy found near the start, with any heading marks.
export function withoutLeadingTitle(excerpt: string, title: string): string {
  const original = excerpt.trim();
  const needle = title.trim().toLowerCase();
  let text = original.replace(/^(…|\.\.\.)\s*/, "");
  for (let pass = 0; pass < 2 && needle; pass += 1) {
    const at = text.toLowerCase().indexOf(needle);
    if (at === -1) break;
    // Only a short lead-in, such as heading marks or the cut-off tail of the
    // title, may sit before the copy. Anything longer is real body text.
    const lead = text.slice(0, at).replace(/#{1,6}\s*$/, "").trim().toLowerCase();
    if (lead && !needle.endsWith(lead)) break;
    text = text.slice(at + needle.length).trimStart();
  }
  return text === original.replace(/^(…|\.\.\.)\s*/, "") ? original : text;
}

// Readable plain text from any Markdown fragment, including the bounded
// excerpts the server returns in place of a full body.
export function plainSummary(markdown: string): string {
  const parts: string[] = [];
  collectText(new Lexer({ gfm: true }).lex(markdown), parts);
  const text = parts.join("").replace(/\s+/g, " ").trim();
  if (!text) return NO_SUMMARY;
  return text.length > SUMMARY_LIMIT ? `${text.slice(0, SUMMARY_LIMIT).trimEnd()}…` : text;
}

function collectText(tokens: Token[], parts: string[]) {
  for (const token of tokens) {
    switch (token.type) {
      case "code":
      case "image":
      case "hr":
      case "space":
      case "def":
      case "checkbox":
        continue;
      case "br":
        parts.push(" ");
        continue;
      case "html":
        // Inline tags such as <b> sit inside words; blocks and <br> separate them.
        parts.push(token.block || /^<br\b/i.test(token.text)
          ? ` ${decodeEntities(token.text.replace(/<[^>]*>?/g, " "))} `
          : decodeEntities(token.text.replace(/<[^>]*>?/g, "")));
        continue;
      case "list":
        collectText(token.items, parts);
        continue;
      case "table":
        for (const cell of [...token.header, ...token.rows.flat()]) {
          collectText(cell.tokens, parts);
          parts.push(" ");
        }
        continue;
    }
    if ("tokens" in token && token.tokens) {
      collectText(token.tokens, parts);
      // Block boundaries separate words even when the source had no space.
      if (BLOCKS.has(token.type)) parts.push(" ");
    } else if ("text" in token && typeof token.text === "string") {
      parts.push(decodeEntities(token.text));
    }
  }
}

function decodeEntities(text: string) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] !== "#") return ENTITIES[name.toLowerCase()] ?? entity;
    const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

export function wordCount(body: string): number {
  const words = bodyWithoutFrontmatter(body).trim().match(/\S+/g);
  return words ? words.length : 0;
}
