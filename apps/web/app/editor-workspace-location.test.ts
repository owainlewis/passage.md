import { parseWorkspaceLocation, workspaceLoginPath } from "./editor-workspace-location";

describe("workspace locations", () => {
  it.each([
    ["/write", ""],
    ["/write/public-id", ""]
  ])("keeps the canonical location %s%s", (pathname, search) => {
    expect(parseWorkspaceLocation(pathname, search)).toEqual({ canonicalPath: pathname, shouldReplace: false });
  });

  it.each([
    ["/write", "?view=starred", "/write"],
    ["/write", "?view=templates", "/write"],
    ["/write", "?collection=research", "/write"],
    ["/write/", "", "/write"],
    ["/write/public-id", "?view=starred", "/write/public-id"]
  ])("replaces the retired location %s%s", (pathname, search, canonicalPath) => {
    expect(parseWorkspaceLocation(pathname, search)).toEqual({ canonicalPath, shouldReplace: true });
  });

  it("keeps the query through an authenticated redirect", () => {
    expect(workspaceLoginPath("/write/abc", "?x=1")).toBe("/login?next=%2Fwrite%2Fabc%3Fx%3D1");
  });
});
