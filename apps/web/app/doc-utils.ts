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

export function snippetOf(body: string): string {
  const lines = bodyWithoutFrontmatter(body).split("\n").map((l) => l.trim());
  const titleSeen = lines.findIndex((l) => l.length > 0);
  for (let i = titleSeen + 1; i < lines.length; i++) {
    if (lines[i]) return lines[i].replace(/^#{1,6}\s+/, "").replace(/[*_`>#]/g, "").trim();
  }
  return "No additional text";
}

export function wordCount(body: string): number {
  const words = bodyWithoutFrontmatter(body).trim().match(/\S+/g);
  return words ? words.length : 0;
}
