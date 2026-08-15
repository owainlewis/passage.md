import { WorkspaceView } from "./editor-workspace-model";

const WORKSPACE_VIEW_PATHS = {
  starred: "/write?view=starred",
  recent: "/write?view=recent",
  templates: "/write?view=templates",
  collections: "/write?view=collections"
} as const;

type RestorableWorkspaceView = Exclude<WorkspaceView, { type: "document" }>;

export type WorkspaceLocation = {
  canonicalPath: string;
  shouldReplace: boolean;
  view: WorkspaceView;
};

export function workspacePath(view: RestorableWorkspaceView) {
  if (view.type === "home") return "/write";
  if (view.type === "collection") {
    return `/write?collection=${encodeURIComponent(view.slug)}`;
  }
  return WORKSPACE_VIEW_PATHS[view.type];
}

export function parseWorkspaceLocation(pathname: string, search: string): WorkspaceLocation {
  if (/^\/write\/[^/]+$/.test(pathname)) {
    return {
      canonicalPath: pathname,
      shouldReplace: search !== "",
      view: { type: "document" }
    };
  }

  const params = new URLSearchParams(search);
  const collection = params.get("collection")?.trim();
  let view: RestorableWorkspaceView;

  if (collection) {
    view = { type: "collection", slug: collection };
  } else {
    const requestedView = params.get("view");
    if (requestedView === "starred" || requestedView === "recent" || requestedView === "templates" || requestedView === "collections") {
      view = { type: requestedView };
    } else {
      view = { type: "home" };
    }
  }

  const canonicalPath = workspacePath(view);
  return {
    canonicalPath,
    shouldReplace: `${pathname}${search}` !== canonicalPath,
    view
  };
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
