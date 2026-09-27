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
  fireEvent.click(screen.getByRole("button", { name: "Format text" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Paragraph style" }), { target: { value: "2" } });
  expect(change).toHaveBeenLastCalledWith("## Finished draft\n");
});

it("replaces remote content without autosaving it or resurrecting it with undo", async () => {
  const change = vi.fn();
  const view = render(<VisualEditor source="# First\n" onChange={change} onSource={vi.fn()} />);
  const input = await screen.findByRole("textbox", { name: "Visual editor" });
  fireEvent.click(screen.getByRole("button", { name: "Format text" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Paragraph style" }), { target: { value: "2" } });
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

it("keeps formatting out of the way until requested and supports Escape", async () => {
  render(<VisualEditor source="A quiet space to write.\n" onChange={vi.fn()} onSource={vi.fn()} />);
  await screen.findByRole("textbox", { name: "Visual editor" });
  expect(screen.queryByRole("group", { name: "Text formatting" })).not.toBeInTheDocument();
  const trigger = screen.getByRole("button", { name: "Format text" });
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Escape" });
  expect(screen.queryByRole("group", { name: "Text formatting" })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it("opens tools for an editor selection, then hides them when it collapses", async () => {
  render(<VisualEditor source="Select these words.\n" onChange={vi.fn()} onSource={vi.fn()} />);
  const input = await screen.findByRole("textbox", { name: "Visual editor" });
  const text = input.querySelector("p")!.firstChild!;
  const selection = window.getSelection()!;
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, 6);
  range.getBoundingClientRect = () => ({ top: 200, bottom: 230, left: 50, right: 130, width: 80, height: 30, x: 50, y: 200, toJSON: () => ({}) });
  act(() => { selection.removeAllRanges(); selection.addRange(range); fireEvent(document, new Event("selectionchange")); });
  expect(screen.getByRole("group", { name: "Text formatting" })).toBeVisible();
  act(() => { selection.collapse(text, 6); fireEvent(document, new Event("selectionchange")); });
  expect(screen.queryByRole("group", { name: "Text formatting" })).not.toBeInTheDocument();
});


it("dismisses selection tools from the editor without moving focus or reopening on scroll", async () => {
  render(<VisualEditor source="Select these words.\n" onChange={vi.fn()} onSource={vi.fn()} />);
  const input = await screen.findByRole("textbox", { name: "Visual editor" });
  input.focus();
  const text = input.querySelector("p")!.firstChild!;
  const selection = window.getSelection()!;
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, 6);
  range.getBoundingClientRect = () => ({ top: 200, bottom: 230, left: 50, right: 130, width: 80, height: 30, x: 50, y: 200, toJSON: () => ({}) });
  act(() => { selection.removeAllRanges(); selection.addRange(range); fireEvent(document, new Event("selectionchange")); });
  expect(screen.getByRole("group", { name: "Text formatting" })).toBeVisible();
  fireEvent.keyDown(input, { key: "Escape" });
  fireEvent.scroll(document);
  expect(screen.queryByRole("group", { name: "Text formatting" })).not.toBeInTheDocument();
  expect(input).toHaveFocus();
});
