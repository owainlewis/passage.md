import { fireEvent, render, screen } from "@testing-library/react";
import { EditorControls } from "./editor-controls";

const props = () => ({
  mode: "write" as const, onModeChange: vi.fn(), focusMode: false, onToggleFocus: vi.fn(),
  onCopy: vi.fn(), onExport: vi.fn(), onDelete: vi.fn(), deleteDisabled: false,
  onCopyLink: vi.fn(), onShare: vi.fn(), shareLabel: "Share", shareState: "idle" as const, shareOpen: false
});

it("supports menu keyboard navigation, escape and focus return", () => {
  const actions = props();
  render(<EditorControls {...actions} />);
  const trigger = screen.getByRole("button", { name: "Document actions" });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(screen.getByRole("menuitem", { name: "Copy Markdown" })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "End" });
  expect(screen.getByRole("menuitem", { name: "Delete document" })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(actions.onDelete).not.toHaveBeenCalled();
});

it("closes the menu and restores focus before invoking an action", () => {
  const actions = props();
  actions.onExport.mockImplementation(() => expect(screen.getByRole("button", { name: "Document actions" })).toHaveFocus());
  render(<EditorControls {...actions} />);
  fireEvent.click(screen.getByRole("button", { name: "Document actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Export Markdown" }));
  expect(actions.onExport).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("dismisses on outside interaction and keeps disabled delete out of keyboard navigation", () => {
  render(<EditorControls {...props()} deleteDisabled />);
  fireEvent.click(screen.getByRole("button", { name: "Document actions" }));
  fireEvent.keyDown(document.activeElement!, { key: "End" });
  expect(screen.getByRole("menuitem", { name: "Copy link" })).toHaveFocus();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});
