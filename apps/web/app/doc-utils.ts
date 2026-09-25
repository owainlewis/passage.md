import { Lexer, type Token } from "marked";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---(?:\n|$)/;
const TAG_RE = /^[a-z]+(?:-[a-z]+)*$/;

export function isValidTag(tag: string): boolean {
  return TAG_RE.test(tag);
}

export function parseTagInput(input: string): { tags: string[]; invalid: string[] } {
  const rawTags = input
    .split(/[,\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  const invalid = rawTags.filter((tag) => !isValidTag(tag));
  const tags = Array.from(new Set(rawTags.filter(isValidTag)));
  return { tags, invalid };
}

export function parseTags(body: string): string[] {
  const match = body.match(FRONTMATTER_RE);
  if (!match) return [];
  const lines = match[1].split("\n");
  for (const line of lines) {
    const arrayMatch = line.match(/^tags:\s*\[(.*)\]\s*$/);
    if (!arrayMatch) continue;
    const tags = arrayMatch[1]
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    return Array.from(new Set(tags.filter(isValidTag)));
  }
  return [];
}

export function bodyWithoutFrontmatter(body: string): string {
  return body.replace(FRONTMATTER_RE, "").replace(/^\n+/, "");
}

export function bodyWithTags(body: string, tags: string[]): string {
  const content = bodyWithoutFrontmatter(body);
  if (tags.length === 0) return content;
  const frontmatter = `---\ntags: [${tags.join(", ")}]\n---`;
  return content ? `${frontmatter}\n\n${content}` : `${frontmatter}\n\n`;
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
  const lines = bodyWithoutFrontmatter(body).split("\n");
  const titleLine = lines.findIndex((line) => line.trim().length > 0);
  if (titleLine === -1) return NO_SUMMARY;
  return plainSummary(lines.slice(titleLine + 1).join("\n"));
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
