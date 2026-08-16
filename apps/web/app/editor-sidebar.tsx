"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "./brand";
import { Doc } from "./editor-model";
import { collectionForDoc, WorkspaceCollection, WorkspaceView } from "./editor-workspace-model";
import { DocIcon, HomeIcon, RecentIcon, SearchIcon, StarIcon, UserIcon } from "./icons";

type EditorSidebarProps = {
  accountEmail?: string;
  assignments: Record<string, string>;
  collections: WorkspaceCollection[];
  docs: Doc[];
  deletedCollections: string[];
  onOpenCollection: (slug: string) => void;
  onOpenSearch: () => void;
  onOpenTemplates: () => void;
  onOpenView: (view: WorkspaceView) => void;
  sidebarOpen: boolean;
  templateCount: number;
  templatesActive: boolean;
  view: WorkspaceView;
};

export function EditorSidebar({
  accountEmail,
  assignments,
  collections,
  docs,
  deletedCollections,
  onOpenCollection,
  onOpenSearch,
  onOpenTemplates,
  onOpenView,
  sidebarOpen,
  templateCount,
  templatesActive,
  view
}: EditorSidebarProps) {
  const starredCount = docs.filter((doc) => doc.pinned).length;

  return (
    <>
      <aside
        className="sidebar workspaceSidebar"
        aria-hidden={!sidebarOpen}
        aria-label="Workspace navigation"
        data-open={sidebarOpen}
        inert={sidebarOpen ? undefined : true}
      >
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
          <SidebarDestination active={view.type === "home" && !templatesActive} icon={<HomeIcon />} label="Home" onClick={() => onOpenView({ type: "home" })} />
          <SidebarDestination active={view.type === "starred" && !templatesActive} icon={<StarIcon filled={false} />} label="Starred" count={starredCount} onClick={() => onOpenView({ type: "starred" })} />
          <SidebarDestination active={view.type === "recent" && !templatesActive} icon={<RecentIcon />} label="Recent" onClick={() => onOpenView({ type: "recent" })} />
          <SidebarDestination active={templatesActive} ariaLabel="Templates" icon={<DocIcon />} label="Templates" count={templateCount} onClick={onOpenTemplates} />
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
                <span title={collection.title}>{collection.title}</span>
                <small>{count}</small>
              </button>
            );
          })}
        </div>

        <div className="sidebarFoot workspaceSidebarFoot">
          <Link className="workspaceSidebarAccount" href="/account">
            <UserIcon />
            <span className="workspaceSidebarAccountText">
              <strong>Settings</strong>
              {accountEmail && <small title={accountEmail}>{accountEmail}</small>}
            </span>
          </Link>
        </div>
      </aside>

      <nav className="workspaceMobileNav" aria-label="Mobile workspace navigation">
        <MobileDestination active={view.type === "home" && !templatesActive} icon={<HomeIcon />} label="Home" onClick={() => onOpenView({ type: "home" })} />
        <MobileDestination active={view.type === "starred" && !templatesActive} icon={<StarIcon filled={false} />} label="Starred" onClick={() => onOpenView({ type: "starred" })} />
        <MobileDestination active={false} icon={<SearchIcon />} label="Search" onClick={onOpenSearch} />
        <MobileDestination active={view.type === "recent" && !templatesActive} icon={<RecentIcon />} label="Recent" onClick={() => onOpenView({ type: "recent" })} />
        <MobileDestination active={view.type === "collections" || view.type === "collection"} icon={<DocIcon />} label="Collections" onClick={() => onOpenView({ type: "collections" })} />
      </nav>
    </>
  );
}

function MobileDestination({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" data-active={active} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function SidebarDestination({ active, ariaLabel, count, icon, label, onClick }: { active: boolean; ariaLabel?: string; count?: number; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={ariaLabel} className="workspaceDestination" data-active={active} onClick={onClick}>
      {icon}
      <span>{label}</span>
      {count !== undefined && <small>{count}</small>}
    </button>
  );
}
