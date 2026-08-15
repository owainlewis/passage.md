import { parseWorkspaceLocation, workspaceLoginPath, workspacePath } from "./editor-workspace-location";

describe("workspace locations", () => {
  it.each([
    ["/write", "", { type: "home" }, "/write"],
    ["/write", "?view=starred", { type: "starred" }, "/write?view=starred"],
    ["/write", "?view=recent", { type: "recent" }, "/write?view=recent"],
    ["/write", "?view=templates", { type: "templates" }, "/write?view=templates"],
    ["/write", "?view=collections", { type: "collections" }, "/write?view=collections"],
    ["/write", "?collection=research", { type: "collection", slug: "research" }, "/write?collection=research"],
    ["/write/public-id", "", { type: "document" }, "/write/public-id"]
  ])("parses the canonical location %s%s", (pathname, search, view, canonicalPath) => {
    expect(parseWorkspaceLocation(pathname, search)).toEqual({
      canonicalPath,
      shouldReplace: false,
      view
    });
  });

  it.each([
    ["/write", "?view=unknown", { type: "home" }, "/write"],
    ["/write", "?view=recent&extra=1", { type: "recent" }, "/write?view=recent"],
    ["/write", "?collection=research&view=starred", { type: "collection", slug: "research" }, "/write?collection=research"],
    ["/write/public-id", "?view=starred", { type: "document" }, "/write/public-id"]
  ])("returns a replacement for non-canonical location %s%s", (pathname, search, view, canonicalPath) => {
    expect(parseWorkspaceLocation(pathname, search)).toEqual({
      canonicalPath,
      shouldReplace: true,
      view
    });
  });

  it("encodes collection slugs in copied workspace links", () => {
    expect(workspacePath({ type: "collection", slug: "research notes" })).toBe("/write?collection=research%20notes");
  });

  it("keeps the canonical query through an authenticated redirect", () => {
    expect(workspaceLoginPath("/write", "?collection=research")).toBe(
      "/login?next=%2Fwrite%3Fcollection%3Dresearch"
    );
  });
});
