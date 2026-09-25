import { workspaceDocSummary } from "./editor-workspace-model";

describe("workspaceDocSummary", () => {
  it("summarises a server excerpt with the same parser as a loaded body", () => {
    const markdown = "# Launch\n\nRead [the brief](https://example.com) ~~today~~<br />now.";
    const excerpt = { id: "excerpt", body: "", title: "Launch", excerpt: markdown };
    const loaded = { id: "loaded", body: markdown, bodyLoaded: true };

    expect(workspaceDocSummary(excerpt)).toBe("Read the brief today now.");
    expect(workspaceDocSummary(loaded)).toBe(workspaceDocSummary(excerpt));
  });

  it("drops a plain title line from an excerpt and cleans what follows", () => {
    expect(workspaceDocSummary({ id: "a", body: "", title: "Notes", excerpt: "Notes\n\n**Bold** start" })).toBe("Bold start");
    expect(workspaceDocSummary({ id: "b", body: "", title: "Notes", excerpt: "Notes" })).toBe("No additional text");
  });

  it("cleans an excerpt that does not begin with its title", () => {
    expect(workspaceDocSummary({ id: "c", body: "", title: "Other", excerpt: "Some *emphasis* and <em>html</em>" }))
      .toBe("Some emphasis and html");
  });
});
