import { StrictMode, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VisualEditor } from "./visual-editor";

it("mounts once under Strict Mode and synchronizes edits without losing typed text", async () => {
  const change = vi.fn();
  function Document() {
    const [body, setBody] = useState("# First draft\n");
    return <VisualEditor source={body} onSource={vi.fn()} onChange={(value) => { change(value); setBody(value); }} />;
  }
  render(<StrictMode><Document /></StrictMode>);
  const input = await screen.findByRole("textbox", { name: "Visual editor" });
  expect(screen.getAllByRole("textbox", { name: "Visual editor" })).toHaveLength(1);
  expect(change).not.toHaveBeenCalled();
  act(() => { input.querySelector("h1")!.textContent = "Finished draft"; fireEvent.input(input); });
  await waitFor(() => expect(change).toHaveBeenLastCalledWith("# Finished draft\n"));
  expect(input).toHaveTextContent("Finished draft");
  fireEvent.keyDown(input, { key: "2", code: "Digit2", ctrlKey: true, altKey: true });
  expect(change).toHaveBeenLastCalledWith("## Finished draft\n");
});

it("replaces remote content without autosaving it or resurrecting it with undo", async () => {
  const change = vi.fn();
  const view = render(<VisualEditor source="# First\n" onChange={change} onSource={vi.fn()} />);
  const input = await screen.findByRole("textbox", { name: "Visual editor" });
  fireEvent.keyDown(input, { key: "2", code: "Digit2", ctrlKey: true, altKey: true });
  change.mockClear();
  view.rerender(<VisualEditor source="# Latest from agent\n" onChange={change} onSource={vi.fn()} />);
  expect(input).toHaveTextContent("Latest from agent");
  fireEvent.keyDown(input, { key: "z", ctrlKey: true });
  expect(input.querySelector("h1")).toHaveTextContent("Latest from agent");
  expect(change).not.toHaveBeenCalled();
});

it("offers Source without saving a document that cannot round-trip", async () => {
  const change = vi.fn();
  const source = vi.fn();
  render(<VisualEditor source={'```js title="sample"\nconst value = 1;\n```\n'} onChange={change} onSource={source} />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit source" }));
  expect(source).toHaveBeenCalledOnce();
  expect(change).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox", { name: "Visual editor" })).not.toBeInTheDocument();
});


it("uses slash commands and keyboard shortcuts without a persistent formatting toolbar", async () => {
  const change = vi.fn();
  render(<VisualEditor source={"A quiet space to write.\n"} onChange={change} onSource={vi.fn()} />);
  const input = await screen.findByRole("textbox", { name: "Visual editor" });
  expect(screen.queryByRole("group", { name: "Text formatting" })).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Paragraph style" })).not.toBeInTheDocument();
  expect(document.querySelector(".formatBarDock")).toBeNull();
  input.focus();
  const range = document.createRange();
  range.selectNodeContents(input.querySelector("p")!);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent(document, new Event("selectionchange"));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  fireEvent.keyDown(input, { key: "b", code: "KeyB", ctrlKey: true });
  expect(input.querySelector("strong")).toHaveTextContent("A quiet space to write.");
  expect(change).toHaveBeenCalled();
});

beforeAll(() => {
  // jsdom has no caret geometry; menu placement is visually unverified.
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

async function putCaretAtEnd(input: HTMLElement) {
  input.focus();
  const paragraph = input.querySelector("p")!;
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  range.collapse(false);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent(document, new Event("selectionchange"));
  await new Promise((resolve) => setTimeout(resolve, 30));
}

it("filters slash commands and applies a heading from the keyboard with undo", async () => {
  const change = vi.fn();
  render(<VisualEditor source={"/h2\n"} onChange={change} onSource={vi.fn()} />);
  const input = await screen.findByRole("textbox", { name: "Visual editor" });
  await act(async () => { await putCaretAtEnd(input); });
  const menu = await screen.findByRole("listbox", { name: "Insert block" });
  expect(menu).toHaveTextContent("Heading 2");
  expect(screen.queryByRole("option", { name: "Bullet list" })).not.toBeInTheDocument();
  expect(input).toHaveAttribute("aria-activedescendant", menu.querySelector<HTMLButtonElement>('[aria-label="Heading 2"]')!.id);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input.querySelector("h2")).not.toBeNull();
  expect(input).not.toHaveTextContent("/h2");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(input).toHaveFocus();
  expect(change).toHaveBeenCalledOnce();
  fireEvent.keyDown(input, { key: "z", code: "KeyZ", ctrlKey: true });
  expect(input).toHaveTextContent("/h2");
});

it("dismisses slash commands with Escape without changing Markdown", async () => {
  const change = vi.fn();
  render(<VisualEditor source={"/\n"} onChange={change} onSource={vi.fn()} />);
  const input = await screen.findByRole("textbox", { name: "Visual editor" });
  await act(async () => { await putCaretAtEnd(input); });
  await screen.findByRole("listbox", { name: "Insert block" });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(input).toHaveTextContent("/");
  expect(change).not.toHaveBeenCalled();
  expect(input).toHaveFocus();
});

it("supports keyboard navigation and pointer insertion of a task block", async () => {
  render(<VisualEditor source={"/list\n"} onChange={vi.fn()} onSource={vi.fn()} />);
  const input = await screen.findByRole("textbox", { name: "Visual editor" });
  await act(async () => { await putCaretAtEnd(input); });
  await screen.findByRole("listbox", { name: "Insert block" });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(screen.getByRole("option", { name: "Numbered list" })).toHaveAttribute("aria-selected", "true");
  fireEvent.click(screen.getByRole("option", { name: "To-do list" }));
  expect(input.querySelector('input[type="checkbox"]')).not.toBeNull();
  expect(input).not.toHaveTextContent("/list");
  expect(input).toHaveFocus();
});
