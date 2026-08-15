"use client";

import { Brand } from "./brand";
import { Doc } from "./editor-model";
import { collectionForDoc, WorkspaceCollection, WorkspaceView } from "./editor-workspace-model";
import { DocIcon, SearchIcon } from "./icons";

type EditorSidebarProps = {
  assignments: Record<string, string>;
  collections: WorkspaceCollection[];
  docs: Doc[];
  deletedCollections: string[];
  onOpenCollection: (slug: string) => void;
  onOpenSearch: () => void;
  onOpenTemplates: () => void;
  onOpenView: (view: WorkspaceView) => void;
  onToggleDarkMode: () => void;
  sidebarOpen: boolean;
  templateCount: number;
  templatesActive: boolean;
  theme: "light" | "dark";
  view: WorkspaceView;
};

export function EditorSidebar({
  assignments,
  collections,
  docs,
  deletedCollections,
  onOpenCollection,
  onOpenSearch,
  onOpenTemplates,
  onOpenView,
  onToggleDarkMode,
  sidebarOpen,
  templateCount,
  templatesActive,
  theme,
  view
}: EditorSidebarProps) {
  const darkActive = theme === "dark";
  const starredCount = docs.filter((doc) => doc.pinned).length;

  return (
    <>
      <aside className="sidebar workspaceSidebar" aria-label="Workspace navigation" data-open={sidebarOpen}>
        <div className="sidebarHead workspaceSidebarHead">
          <Brand href="/write" />
        </div>

        <div className="workspaceSidebarSearch">
          <button type="button" onClick={onOpenSearch}>
            <SearchIcon />
            <span>Search</span>
            <kbd>⌘ K</kbd>
          </button>
        </div>

        <nav className="workspaceDestinations" aria-label="Workspace destinations">
          <SidebarDestination active={view.type === "home" && !templatesActive} label="Home" onClick={() => onOpenView({ type: "home" })} />
          <SidebarDestination active={view.type === "starred" && !templatesActive} label="Starred" count={starredCount} onClick={() => onOpenView({ type: "starred" })} />
          <SidebarDestination active={view.type === "recent" && !templatesActive} label="Recent" onClick={() => onOpenView({ type: "recent" })} />
          <SidebarDestination active={templatesActive} ariaLabel="Templates" label="Templates" count={templateCount} onClick={onOpenTemplates} />
        </nav>

        <div className="workspaceSidebarCollections">
          <div className="workspaceSidebarLabel">
            <button type="button" className="workspaceSidebarCollectionsLink" aria-label="View all collections" onClick={() => onOpenView({ type: "collections" })}>Collections</button>
            <button type="button" className="workspaceSidebarCollectionAdd" aria-label="New collection" onClick={() => onOpenView({ type: "collections", createRequest: Date.now() })}>+</button>
          </div>
          {collections.map((collection) => {
            const count = docs.filter((doc) => collectionForDoc(doc, assignments, deletedCollections) === collection.slug).length;
            return (
              <button
                type="button"
                className="workspaceSidebarCollection"
                data-active={view.type === "collection" && view.slug === collection.slug && !templatesActive}
                key={collection.slug}
                onClick={() => onOpenCollection(collection.slug)}
              >
                <span>{collection.title}</span>
                <small>{count}</small>
              </button>
            );
          })}
        </div>

        <div className="sidebarFoot workspaceSidebarFoot">
          <div className="themeToggle">
            <span className={theme === "light" ? "themeLabel active" : "themeLabel"}>Light</span>
            <button
              type="button"
              role="switch"
              aria-checked={darkActive}
              aria-label="Dark mode"
              className={`switch ${darkActive ? "on" : ""}`}
              onClick={onToggleDarkMode}
            >
              <span className="switchKnob" />
            </button>
            <span className={theme === "dark" ? "themeLabel active" : "themeLabel"}>Dark</span>
          </div>
        </div>
      </aside>

      <nav className="workspaceMobileNav" aria-label="Mobile workspace navigation">
        <SidebarDestination active={view.type === "home" && !templatesActive} label="Home" onClick={() => onOpenView({ type: "home" })} />
        <SidebarDestination active={view.type === "starred" && !templatesActive} label="Starred" onClick={() => onOpenView({ type: "starred" })} />
        <button type="button" onClick={onOpenSearch}><SearchIcon /><span>Search</span></button>
        <SidebarDestination active={view.type === "recent" && !templatesActive} label="Recent" onClick={() => onOpenView({ type: "recent" })} />
        <button type="button" data-active={view.type === "collections" || view.type === "collection"} onClick={() => onOpenView({ type: "collections" })}><DocIcon /><span>Collections</span></button>
      </nav>
    </>
  );
}

function SidebarDestination({ active, ariaLabel, count, label, onClick }: { active: boolean; ariaLabel?: string; count?: number; label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={ariaLabel} className="workspaceDestination" data-active={active} onClick={onClick}>
      <span>{label}</span>
      {count !== undefined && <small>{count}</small>}
    </button>
  );
}
