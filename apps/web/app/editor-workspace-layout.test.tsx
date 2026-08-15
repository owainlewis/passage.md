import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { EditorWorkspace } from "./editor-workspace";
import type { Doc } from "./editor-model";
import { WORKSPACE_COLLECTIONS } from "./editor-workspace-model";
import type { WorkspaceCollection } from "./editor-workspace-model";

const stylesheet = readFileSync("app/globals.css", "utf8");

function declarationsFor(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stylesheet.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull();
  return match![1].replace(/\s+/g, " ");
}

function homeWorkspace(collections: WorkspaceCollection[], docs: Doc[]) {
  return (
    <EditorWorkspace
      assignments={{}}
      assignmentDisabled={false}
      collectionAvailable
      collections={collections}
      docs={docs}
      deletedCollections={[]}
      saveState="saved"
      view={{ type: "home" }}
      onAssignCollection={vi.fn()}
      onCreateCollection={vi.fn()}
      onDeleteCollection={vi.fn()}
      onOpenCollection={vi.fn()}
      onOpenDocument={vi.fn()}
      onOpenSearch={vi.fn()}
      onOpenView={vi.fn()}
      hasMoreDocs={false}
      loadingMore={false}
      onLoadMoreDocs={vi.fn()}
      onToggleStar={vi.fn()}
      onUpdateCollection={vi.fn()}
      pendingCollectionSlugs={new Set()}
      pendingDocIds={new Set()}
    />
  );
}

function workspaceShell(sidebarOpen: boolean, content: ReactNode) {
  return <div className={`workspace ${sidebarOpen ? "withSidebar" : ""}`}>{content}</div>;
}

it("keeps every home section on one left edge with the sidebar open or closed", () => {
  const content = homeWorkspace(WORKSPACE_COLLECTIONS, []);
  const view = render(workspaceShell(true, content));
  const home = screen.getByLabelText("Workspace home");

  expect(home).toHaveClass("workspaceHome");
  expect(Array.from(home.children).map((child) => child.className)).toEqual([
    "workspaceHero",
    "workspaceSection",
    "workspaceSection"
  ]);
  expect(declarationsFor(".workspaceHome > *")).toContain("margin-left: 0;");

  view.rerender(workspaceShell(false, content));
  expect(screen.getByLabelText("Workspace home")).toHaveClass("workspaceHome");
  expect(document.querySelector(".workspace")).not.toHaveClass("withSidebar");
});

it("keeps the virtual Documents view and empty sections readable", () => {
  render(homeWorkspace(WORKSPACE_COLLECTIONS, []));
  const home = screen.getByLabelText("Workspace home");
  const collections = within(home).getByRole("heading", { name: "Collections" }).closest("section")!;
  const recent = within(home).getByRole("heading", { name: "Recent" }).closest("section")!;

  expect(within(collections).getAllByRole("button")).toHaveLength(2);
  expect(within(collections).getByRole("button", { name: /Documents0 files/ })).toHaveTextContent(
    "General Markdown that has not been assigned to another collection."
  );
  expect(within(recent).getByText("No documents yet.")).toBeInTheDocument();
});

it("keeps collection modal surfaces fixed to the full viewport", () => {
  expect(declarationsFor(".workspace.workspaceCollectionDialogBackdrop")).toMatch(/position: fixed;.*inset: 0;/);
  expect(declarationsFor(".workspace.workspaceCollectionDialogBackdrop")).toContain("place-items: center;");
  expect(declarationsFor(".workspace.workspaceCollectionDialogBackdrop")).toContain("padding: 24px;");
  expect(declarationsFor(".workspace.workspaceCollectionDialogBackdrop")).toContain("overscroll-behavior: contain;");
  expect(declarationsFor(".workspaceCollectionDialog")).toContain("max-height: calc(100dvh - 48px);");
  expect(declarationsFor(".workspaceCollectionDialog")).toContain("overflow-y: auto;");
  expect(declarationsFor(".workspaceCollectionDialog header p")).toContain("overflow-wrap: anywhere;");
  expect(declarationsFor(".workspaceCollectionDialog footer button.workspaceCollectionDialogDanger"))
    .toContain("background: #a04a3e;");
});

it("wraps long collection copy while preserving a large count", () => {
  const longTitle = "Collection".repeat(20);
  const longDescription = "description".repeat(24);
  const collection = { slug: "large", title: longTitle, description: longDescription };
  const docs = Array.from({ length: 1234 }, (_, index) => ({
    id: `doc-${index}`,
    body: `# Document ${index}`,
    bodyLoaded: true,
    collectionSlug: collection.slug,
    updatedAt: new Date(2026, 0, 1, 0, 0, index).toISOString()
  }));

  render(homeWorkspace([...WORKSPACE_COLLECTIONS, collection], docs));

  const card = screen.getByText(longTitle).closest("button")!;
  expect(card).toHaveTextContent("1234 files");
  expect(card).toHaveTextContent(longDescription);
  expect(declarationsFor(".workspaceCollectionTitle strong")).toMatch(/min-width: 0;.*overflow-wrap: anywhere;/);
  expect(declarationsFor(".workspaceCollectionDescription")).toContain("overflow-wrap: anywhere;");
  expect(stylesheet).toMatch(/\.workspaceSidebarCollection > span:first-child\s*\{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;/);
  expect(declarationsFor(".workspaceHub")).toContain("overflow-x: hidden;");
});
