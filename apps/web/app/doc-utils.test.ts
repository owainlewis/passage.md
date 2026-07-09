import {
  bodyWithTags,
  bodyWithoutFrontmatter,
  isValidTag,
  parseTagInput,
  parseTags,
  snippetOf,
  titleOf,
  wordCount
} from "./doc-utils";

describe("titleOf", () => {
  it("derives the title from the first non-empty line and strips heading marks", () => {
    expect(titleOf("# Launch note\n\nBody")).toBe("Launch note");
  });

  it("keeps hyphens inside words", () => {
    expect(titleOf("# well-known release notes")).toBe("well-known release notes");
  });

  it("falls back to Untitled for empty input", () => {
    expect(titleOf("   \n\n")).toBe("Untitled");
  });
});

describe("snippetOf", () => {
  it("returns the first line of body after the title", () => {
    expect(snippetOf("# Title\n\nFirst real line.")).toBe("First real line.");
  });
});

describe("wordCount", () => {
  it("counts whitespace-separated tokens", () => {
    expect(wordCount("one two three")).toBe(3);
    expect(wordCount("   ")).toBe(0);
  });
});

describe("tags", () => {
  it("accepts lowercase words joined by hyphens", () => {
    expect(isValidTag("notes")).toBe(true);
    expect(isValidTag("video-script")).toBe(true);
  });

  it("rejects uppercase, numbers, underscores, and loose hyphens", () => {
    expect(isValidTag("Notes")).toBe(false);
    expect(isValidTag("v2")).toBe(false);
    expect(isValidTag("video_script")).toBe(false);
    expect(isValidTag("-notes")).toBe(false);
    expect(isValidTag("notes-")).toBe(false);
  });

  it("parses comma and whitespace separated input", () => {
    expect(parseTagInput("notes, scripts notes").tags).toEqual(["notes", "scripts"]);
    expect(parseTagInput("notes, Drafts").invalid).toEqual(["Drafts"]);
  });

  it("reads and writes frontmatter tags without using them as content", () => {
    const body = bodyWithTags("# Launch note\n\nBody", ["notes", "scripts"]);

    expect(parseTags(body)).toEqual(["notes", "scripts"]);
    expect(titleOf(body)).toBe("Launch note");
    expect(snippetOf(body)).toBe("Body");
    expect(wordCount(body)).toBe(4);
    expect(bodyWithoutFrontmatter(body)).toBe("# Launch note\n\nBody");
  });
});

describe("legacy folder frontmatter", () => {
  it("removes folder metadata when tags are saved", () => {
    const body = bodyWithTags("---\nfolder: scripts\n---\n\n# Launch note\n\nBody", ["notes"]);

    expect(body).toBe("---\ntags: [notes]\n---\n\n# Launch note\n\nBody");
    expect(titleOf(body)).toBe("Launch note");
    expect(snippetOf(body)).toBe("Body");
    expect(wordCount(body)).toBe(4);
    expect(bodyWithoutFrontmatter(body)).toBe("# Launch note\n\nBody");
  });
});
