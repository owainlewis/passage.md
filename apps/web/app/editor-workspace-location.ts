export type WorkspaceLocation = {
  canonicalPath: string;
  shouldReplace: boolean;
};

/**
 * The workspace has two addresses: the writer at /write and a document at
 * /write/<publicId>. Older links carried view and collection queries. Those
 * views are gone, so the links land on the writer rather than failing.
 */
export function parseWorkspaceLocation(pathname: string, search: string): WorkspaceLocation {
  if (/^\/write\/[^/]+$/.test(pathname)) {
    return { canonicalPath: pathname, shouldReplace: search !== "" };
  }
  return { canonicalPath: "/write", shouldReplace: `${pathname}${search}` !== "/write" };
}

export function currentWorkspaceLocation() {
  if (typeof window === "undefined") {
    return parseWorkspaceLocation("/write", "");
  }
  return parseWorkspaceLocation(window.location.pathname, window.location.search);
}

export function workspaceLoginPath(pathname: string, search: string) {
  return `/login?next=${encodeURIComponent(`${pathname}${search}`)}`;
}
