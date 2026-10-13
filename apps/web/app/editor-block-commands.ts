export const BLOCK_COMMANDS = [
  { id: "paragraph", label: "Text", description: "A plain paragraph", keywords: "paragraph text" },
  { id: "heading-1", label: "Heading 1", description: "A document title", keywords: "h1 title heading" },
  { id: "heading-2", label: "Heading 2", description: "A section heading", keywords: "h2 section heading" },
  { id: "heading-3", label: "Heading 3", description: "A smaller heading", keywords: "h3 subheading heading" },
  { id: "bullet-list", label: "Bullet list", description: "An unordered list", keywords: "bullet unordered list" },
  { id: "numbered-list", label: "Numbered list", description: "An ordered list", keywords: "number ordered list" },
  { id: "task-list", label: "To-do list", description: "Tasks with checkboxes", keywords: "todo to-do task checkbox list" },
  { id: "quote", label: "Quote", description: "A block quote", keywords: "quote blockquote" },
  { id: "code", label: "Code", description: "A fenced code block", keywords: "code block snippet" },
  { id: "divider", label: "Divider", description: "A horizontal rule", keywords: "divider separator rule" }
] as const;

export type BlockCommand = typeof BLOCK_COMMANDS[number]["id"];

export function matchingBlockCommands(query: string) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return BLOCK_COMMANDS.filter((command) => {
    const text = `${command.label} ${command.keywords}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
