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
      collectionAvailable
      collections={collections}
      docs={docs}
      deletedCollections={[]}
      saveState="saved"
      view={{ type: "home" }}
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

// Recent is the list view that shows per-row actions.
function listWorkspace(docs: Doc[]) {
  return (
    <EditorWorkspace
      assignments={{}}
      collectionAvailable
      collections={WORKSPACE_COLLECTIONS}
      docs={docs}
      deletedCollections={[]}
      saveState="saved"
      view={{ type: "recent" }}
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
  // Every child of the hub takes the same measure, so no element can drift
  // onto its own grid. The misalignment this guards against came from headers
  // using a different width and a different alignment to their own content.
  const column = declarationsFor(".workspaceHub > *");
  expect(column).toContain("max-width: var(--workspace-measure);");
  expect(column).toContain("margin-left: auto;");
  expect(column).toContain("margin-right: auto;");

  view.rerender(workspaceShell(false, content));
  expect(screen.getByLabelText("Workspace home")).toHaveClass("workspaceHome");
  expect(document.querySelector(".workspace")).not.toHaveClass("withSidebar");
});

it("puts every page header on the same column as the content it introduces", () => {
  // These three headers used to cap at 760px and left-align while their
  // sections centred at 1080px, so each title sat on a different grid to its
  // own list.
  const headers = declarationsFor(".workspaceHero,\n.workspacePageHeader,\n.workspaceCollectionHeader");
  expect(headers).not.toContain("max-width: 760px");
  expect(headers).not.toContain("margin-left: 0");

  // Only the collection header carries actions, so only it is a row. A flex
  // hero would lay the title, description and search box out side by side.
  // Matched off the stylesheet directly: declarationsFor would find the
  // grouped rule above, where this selector is the last of three.
  expect(stylesheet).toMatch(/\n\.workspaceCollectionHeader \{[^}]*display: flex;/);
  expect(declarationsFor(".workspaceHero")).not.toContain("display: flex");
  expect(declarationsFor(".workspacePageHeader")).not.toContain("display: flex");
});

it("keeps list rows to opening and starring, with no per-row collection picker", () => {
  const docs = [{
    id: "doc-1",
    body: "# Draft",
    bodyLoaded: true,
    updatedAt: "2026-01-01T00:00:00.000Z"
  }] as Doc[];
  render(listWorkspace(docs));

  expect(screen.getByRole("button", { name: /Star Draft/ })).toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Collection for Draft" })).not.toBeInTheDocument();
  expect(document.querySelector(".workspaceDocumentActions select")).toBeNull();
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

it("stacks the collection header on a phone instead of squeezing the title", () => {
  // The header is a title/actions row on desktop. Left as a row on a phone it
  // crushed the title into a third of the width with the actions stranded in
  // the space beside it.
  expect(stylesheet).toMatch(
    /@media \(max-width: 720px\)[\s\S]*?\.workspaceCollectionHeader\s*\{[^}]*flex-direction: column;/
  );
  expect(stylesheet).toMatch(
    /@media \(max-width: 720px\)[\s\S]*?\.workspaceCollectionHeaderText\s*\{[^}]*max-width: none;/
  );
  // The mobile type rule has to follow the element it styles: the description
  // moved inside the text wrapper and this selector silently stopped matching.
  expect(stylesheet).toMatch(
    /@media \(max-width: 720px\)[\s\S]*?\.workspaceCollectionHeaderText > p\s*\{[^}]*font-size:/
  );
  expect(stylesheet).not.toMatch(/\.workspaceCollectionHeader > p\s*\{/);
});

it("lets notices take their own height instead of the content's", () => {
  // .main used to be grid-template-rows: 56px minmax(0,1fr) auto, which
  // assumed exactly three children. The child count varies with notices, the
  // load-more control and the status bar, so a notice landed in the flexible
  // row and filled the window while the document collapsed beneath it.
  const main = declarationsFor(".main");
  expect(main).toContain("display: flex;");
  expect(main).toContain("flex-direction: column;");
  expect(main).not.toContain("grid-template-rows");

  // Which element grows is stated, not inferred from position.
  expect(declarationsFor(".main > *")).toContain("flex: 0 0 auto;");
  const panes = declarationsFor(".main > .writingPane,\n.main > .templateLibrary,\n.main > .templateEditor,\n.main > .workspaceHub");
  expect(panes).toContain("flex: 1 1 auto;");
  expect(panes).toContain("min-height: 0;");
});

it("hides the browser ring on programmatic focus targets", () => {
  // These carry tabindex="-1" so focus can be moved to them after a navigation
  // or a dialog closes. They are not interactive, so the default ring reads as
  // a stray blue box drawn around the page.
  const rule = declarationsFor(".writingPane:focus,\n.workspaceHub:focus,\n.workspaceCollectionDialog:focus,\n.workspaceCollectionHeader h1:focus");
  expect(rule).toContain("outline: none;");
});

it("keeps narrow editor chrome compact and unobstructed", () => {
  expect(stylesheet).toMatch(
    /@media \(max-width: 720px\)[\s\S]*?\.statusDock\s*\{[^}]*grid-template-columns: auto minmax\(0, 1fr\);/
  );
  expect(stylesheet).toMatch(
    /@media \(max-width: 720px\)[\s\S]*?\.dockGroupMeta\s*\{[^}]*min-width: 0;[^}]*flex-wrap: wrap;/
  );
  expect(stylesheet).toMatch(
    /@media \(max-width: 720px\)[\s\S]*?\.workspace\.withSidebar \.workspaceMobileNav\s*\{[^}]*display: none;/
  );
  // The open document holds the only collection control, so it must survive the
  // narrowest layout rather than be hidden.
  expect(stylesheet).toMatch(
    /@media \(max-width: 360px\)[\s\S]*?\.topBarCollectionSelect\s*\{[^}]*max-width: 104px;/
  );
  expect(stylesheet).not.toMatch(
    /@media \(max-width: 360px\)[\s\S]*?\.topBarCollectionSelect\s*\{[^}]*display: none;/
  );
  expect(declarationsFor(".statusDock")).toContain("border: 1px solid var(--hairline);");
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
