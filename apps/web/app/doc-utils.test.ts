import {
  bodyWithoutFrontmatter,
  plainBlocks,
  plainDocument,
  plainSummary,
  snippetOf,
  titleOf,
  withoutLeadingTitle,
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

  it("returns readable text instead of Markdown and HTML syntax", () => {
    const body = [
      "# Title",
      "",
      "See [a link](https://example.com) and ~~old~~ new<br />text with **bold** and `code`.",
      "",
      "![diagram](https://example.com/d.png)",
      "",
      "```js",
      "const hidden = true;",
      "```",
      "",
      "- first item",
      "- [x] done item",
      "",
      "> quoted &amp; kept"
    ].join("\n");

    expect(snippetOf(body)).toBe("See a link and old new text with bold and code. first item done item quoted & kept");
  });

  it("leaves ordinary prose punctuation alone", () => {
    expect(snippetOf("Title\nPrices rose 5 * 3 times; snake_case_name and a ~ tilde stay, as does 2 > 1.")).toBe(
      "Prices rose 5 * 3 times; snake_case_name and a ~ tilde stay, as does 2 > 1."
    );
  });

  it("keeps inline tags inside words and separates HTML blocks", () => {
    expect(snippetOf("Title\n\nun<b>believ</b>able\n\n<div>One</div>\n\nTwo")).toBe("unbelievable One Two");
  });

  it("reports when there is nothing after the title", () => {
    expect(snippetOf("# Only a title")).toBe("No additional text");
    expect(snippetOf("# Title\n\n![only an image](x.png)")).toBe("No additional text");
    expect(snippetOf("")).toBe("No additional text");
  });

  it("bounds long summaries", () => {
    const summary = snippetOf(`Title\n\n${"word ".repeat(200)}`);
    expect(summary.length).toBeLessThanOrEqual(281);
    expect(summary.endsWith("…")).toBe(true);
  });
});

describe("plainSummary", () => {
  it("reads tables and nested lists as words", () => {
    expect(plainSummary("| A | B |\n| - | - |\n| one | *two* |\n\n1. outer\n   - inner")).toBe("A B one two outer inner");
  });
});

describe("wordCount", () => {
  it("counts whitespace-separated tokens", () => {
    expect(wordCount("one two three")).toBe(3);
    expect(wordCount("   ")).toBe(0);
  });
});

describe("frontmatter", () => {
  it("is not used as content", () => {
    const body = "---\ntags: [notes, scripts]\n---\n\n# Launch note\n\nBody";

    expect(titleOf(body)).toBe("Launch note");
    expect(snippetOf(body)).toBe("Body");
    expect(wordCount(body)).toBe(4);
    expect(bodyWithoutFrontmatter(body)).toBe("# Launch note\n\nBody");
  });
});

describe("withoutLeadingTitle", () => {
  it("drops a repeated title from a search excerpt", () => {
    expect(withoutLeadingTitle("# Morning pages Wrote before coffee", "Morning pages")).toBe("Wrote before coffee");
    expect(withoutLeadingTitle("…Morning pages # Morning pages tea", "Morning pages")).toBe("tea");
  });

  it("keeps an excerpt that does not open with the title", () => {
    expect(withoutLeadingTitle("…before coffee", "Morning pages")).toBe("…before coffee");
  });
});

describe("withoutLeadingTitle with a cut-off title", () => {
  it("drops the tail of the title and the full copy after it", () => {
    expect(withoutLeadingTitle("…that write # Video script: agents that write Hook What if", "Video script: agents that write")).toBe("Hook What if");
  });

  it("keeps body text that happens to mention the title later", () => {
    expect(withoutLeadingTitle("…before coffee I read Morning pages", "Morning pages")).toBe("…before coffee I read Morning pages");
  });
});

describe("plainBlocks", () => {
  it("returns the prose of each block and leaves code out", () => {
    expect(plainBlocks("# Title\n\nA **bold** line.\n\n```js\nconst x = 1;\n```\n\n- One\n- Two\n")).toEqual([
      "Title",
      "A bold line.",
      "One",
      "Two"
    ]);
  });
});

describe("plainDocument", () => {
  it("keeps paragraphs apart and drops the Markdown marks", () => {
    expect(plainDocument("# Launch\n\nA **bold** [link](https://example.com).\n\n> Quoted.\n")).toBe(
      "Launch\n\nA bold link.\n\nQuoted."
    );
  });

  it("keeps bullets, numbers, tasks and nesting in lists", () => {
    expect(plainDocument("- One\n  - Nested\n- Two\n\n3. Three\n4. Four\n\n- [ ] Open\n- [x] Done\n")).toBe(
      "• One\n  • Nested\n• Two\n\n3. Three\n4. Four\n\n☐ Open\n☑ Done"
    );
  });

  it("keeps code as written and leaves frontmatter out", () => {
    expect(plainDocument("---\ntags: [a]\n---\n\nText.\n\n```\nline 1\n  line 2\n```\n")).toBe("Text.\n\nline 1\n  line 2");
  });
});
