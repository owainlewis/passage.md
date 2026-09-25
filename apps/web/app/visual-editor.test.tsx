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
  fireEvent.change(screen.getByRole("combobox", { name: "Paragraph style" }), { target: { value: "2" } });
  expect(change).toHaveBeenLastCalledWith("## Finished draft\n");
});

it("replaces remote content without autosaving it or resurrecting it with undo", async () => {
  const change = vi.fn();
  const view = render(<VisualEditor source="# First\n" onChange={change} onSource={vi.fn()} />);
  const input = await screen.findByRole("textbox", { name: "Visual editor" });
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
