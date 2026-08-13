import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ConceptWorkspace from "./page";

describe("Concept workspace", () => {
  it("uses destinations and collections instead of a document sidebar", () => {
    render(<ConceptWorkspace />);

    const navigation = screen.getByRole("complementary", { name: "Workspace navigation" });
    expect(within(navigation).getByRole("button", { name: "Home" })).toBeInTheDocument();
    expect(within(navigation).getByRole("button", { name: /Starred/ })).toBeInTheDocument();
    expect(within(navigation).getByRole("button", { name: "Recent" })).toBeInTheDocument();
    expect(within(navigation).getByRole("button", { name: /Operating Context/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Good afternoon, Owain." })).toBeInTheDocument();
    expect(screen.getByText("Your Markdown, organised for you and legible to every agent you trust.")).toBeInTheDocument();
  });

  it("opens a collection and explains its agent and context boundaries", () => {
    render(<ConceptWorkspace />);

    fireEvent.click(screen.getAllByRole("button", { name: /Content Studio/ })[0]);

    expect(screen.getByRole("heading", { name: "Content Studio" })).toBeInTheDocument();
    expect(screen.getByText("Writer agents can create and edit drafts.")).toBeInTheDocument();
    expect(screen.getByText("Uses context from")).toBeInTheDocument();
    expect(screen.getAllByText("Operating Context").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Search this collection" })).toBeInTheDocument();
  });

  it("searches full document content within a selected collection", () => {
    render(<ConceptWorkspace />);

    fireEvent.click(screen.getAllByRole("button", { name: /Operating Context/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Search this collection" }));

    const dialog = screen.getByRole("dialog", { name: "Search workspace" });
    expect(within(dialog).getByRole("button", { name: "Operating Context" })).toHaveAttribute("data-active", "true");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Search documents" }), { target: { value: "uninterrupted product work" } });

    expect(within(dialog).getByRole("button", { name: /Current goals/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Your agents need a context layer/ })).not.toBeInTheDocument();
  });

  it("updates personal stars and opens documents with breadcrumbs", () => {
    render(<ConceptWorkspace />);

    fireEvent.click(screen.getAllByRole("button", { name: /Operating Context/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Star Writing voice" }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Workspace destinations" })).getByRole("button", { name: /Starred/ }));

    const writingRow = screen.getByText("Writing voice", { selector: "strong" }).closest("button");
    expect(writingRow).toBeInTheDocument();
    fireEvent.click(writingRow!);

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByRole("button", { name: "Operating Context" })).toBeInTheDocument();
    expect(within(breadcrumb).getByText("writing/writing-voice.md")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Writing voice" })).toBeInTheDocument();
  });

  it("opens global search from the command palette shortcut", () => {
    render(<ConceptWorkspace />);

    fireEvent.click(screen.getAllByRole("button", { name: /Operating Context/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Search this collection" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search documents" }), { target: { value: "goals" } });
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Search workspace" }), { key: "Escape" });
    fireEvent.keyDown(window, { key: "k", metaKey: true });

    const dialog = screen.getByRole("dialog", { name: "Search workspace" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search documents" })).toHaveFocus();
    expect(within(dialog).getByRole("button", { name: "All" })).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("textbox", { name: "Search documents" })).toHaveValue("");
  });

  it("contains modal focus, closes with Escape, and restores the trigger", async () => {
    render(<ConceptWorkspace />);

    const trigger = screen.getByRole("button", { name: /Search 376 documents/ });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Search workspace" });
    const input = within(dialog).getByRole("textbox", { name: "Search documents" });
    expect(input).toHaveFocus();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    const dialogButtons = within(dialog).getAllByRole("button");
    expect(dialogButtons[dialogButtons.length - 1]).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Search workspace" })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("opens an all-collections destination from mobile navigation", () => {
    render(<ConceptWorkspace />);

    const mobileNavigation = screen.getByRole("navigation", { name: "Mobile workspace navigation" });
    fireEvent.click(within(mobileNavigation).getByRole("button", { name: "Collections" }));

    expect(screen.getByRole("heading", { name: "Collections" })).toBeInTheDocument();
    expect(screen.getByText("Collections group related Markdown and give agents a clear boundary for search, context, and access.")).toBeInTheDocument();
  });
});
