import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { DocumentOutline } from "./editor-outline";
import { DocumentStats } from "./editor-stats";
import { Teleprompter } from "./teleprompter";
import { resetWordGoalsForTest, setWordGoal, useWordGoal } from "./word-goals";

const body = `# Script\n\n${Array.from({ length: 60 }, () => "The cat sat on the mat.").join(" ")}\n`;

beforeEach(() => {
  localStorage.clear();
  resetWordGoalsForTest();
});

function Stats({ words = 362, selectedWords = 0, docId = "doc-1" }: { words?: number; selectedWords?: number; docId?: string }) {
  const [goal, setGoal] = useWordGoal(docId);
  return <DocumentStats body={body} words={words} selectedWords={selectedWords} shared={false} goal={goal} onGoal={setGoal} />;
}

describe("document stats", () => {
  it("shows the word count and reading time in the bar", () => {
    render(<Stats />);
    expect(screen.getByRole("button", { name: "Document details" })).toHaveTextContent("362 words2 min read");
  });

  it("shows the selection while there is one", () => {
    render(<Stats selectedWords={12} />);
    expect(screen.getByRole("button", { name: "Document details" })).toHaveTextContent("12 words selected");
  });

  it("opens the counts, times and reading level", () => {
    render(<Stats />);
    fireEvent.click(screen.getByRole("button", { name: "Document details" }));
    const panel = screen.getByRole("dialog", { name: "Document details" });
    expect(within(panel).getByText("Sentences").nextSibling).toHaveTextContent("61");
    expect(within(panel).getByText("Reading time").nextSibling).toHaveTextContent("2 min");
    expect(within(panel).getByText("Speaking time").nextSibling).toHaveTextContent("2 min");
    expect(within(panel).getByText("Reading level").nextSibling).toHaveTextContent("Grade 1 · Very easy");
  });

  it("sets, shows and clears a word goal for the document", () => {
    render(<Stats />);
    fireEvent.click(screen.getByRole("button", { name: "Document details" }));
    const input = screen.getByRole("textbox", { name: "Word goal" });

    fireEvent.change(input, { target: { value: "1,000" } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByRole("button", { name: "Document details" })).toHaveTextContent(/362 \/ 1,000\s*words/);
    expect(screen.getByRole("status")).toHaveTextContent("638 words to go");
    expect(JSON.parse(localStorage.getItem("passage.goals.v1")!)).toEqual({ "doc-1": 1000 });

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(screen.getByRole("button", { name: "Document details" })).toHaveTextContent("362 words");
    expect(JSON.parse(localStorage.getItem("passage.goals.v1")!)).toEqual({});
  });

  it("marks a goal that has been reached", () => {
    act(() => setWordGoal("doc-1", 300));
    render(<Stats />);
    fireEvent.click(screen.getByRole("button", { name: "Document details" }));
    expect(screen.getByRole("status")).toHaveTextContent("Goal reached");
  });

  it("keeps each document's goal to itself", () => {
    act(() => setWordGoal("doc-1", 300));
    render(<Stats docId="doc-2" />);
    expect(screen.getByRole("button", { name: "Document details" })).not.toHaveTextContent("/");
  });

  it("closes on Escape and returns to the count", () => {
    render(<Stats />);
    const button = screen.getByRole("button", { name: "Document details" });
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Word goal" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });
});

describe("document outline", () => {
  const items = [
    { level: 1, text: "Title", words: 900 },
    { level: 2, text: "Hook", words: 120 },
    { level: 2, text: "Story", words: 1780 }
  ];

  it("stays out of the way of a document with few headings", () => {
    render(<DocumentOutline items={items.slice(0, 2)} activeHeading={() => -1} onReveal={() => undefined} />);
    expect(screen.queryByRole("navigation", { name: "Outline" })).not.toBeInTheDocument();
  });

  it("lists the headings with their section words and goes to the one chosen", () => {
    const onReveal = vi.fn();
    render(<DocumentOutline items={items} activeHeading={() => 1} onReveal={onReveal} />);
    const outline = screen.getByRole("navigation", { name: "Outline" });
    expect(within(outline).getByRole("button", { name: /Story/ })).toHaveTextContent("1,780");
    fireEvent.click(within(outline).getByRole("button", { name: /Story/ }));
    expect(onReveal).toHaveBeenCalledWith(2);
  });
});

describe("teleprompter", () => {
  function open(onClose = vi.fn()) {
    render(<Teleprompter source={"---\ntags: [script]\n---\n\n# Intro\n\nHello **there**.\n"} onClose={onClose} />);
    return { onClose, dialog: screen.getByRole("dialog", { name: "Teleprompter" }), script: screen.getByRole("document", { name: "Script" }) };
  }

  it("shows the script without its frontmatter and starts paused", () => {
    const { dialog, script } = open();
    expect(script).toHaveTextContent("Intro Hello there.");
    expect(script).not.toHaveTextContent("tags");
    expect(script).toHaveFocus();
    expect(within(dialog).getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(within(dialog).getByRole("timer")).toHaveTextContent("0:00 / 0:01");
  });

  it("plays and pauses with Space", () => {
    const { dialog, script } = open();
    fireEvent.keyDown(script, { key: " " });
    expect(within(dialog).getByRole("button", { name: "Pause" })).toBeInTheDocument();
    fireEvent.keyDown(script, { key: " " });
    expect(within(dialog).getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("changes speed with the arrow keys, mirrors with M, and remembers both", () => {
    const { dialog, script } = open();
    fireEvent.keyDown(script, { key: "ArrowUp" });
    fireEvent.keyDown(script, { key: "ArrowUp" });
    fireEvent.keyDown(script, { key: "ArrowDown" });
    expect(within(dialog).getByRole("group", { name: "Speed" })).toHaveTextContent("160 wpm");
    fireEvent.keyDown(script, { key: "m" });
    expect(script).toHaveAttribute("data-mirror");
    expect(within(dialog).getByRole("button", { name: "Mirror" })).toHaveAttribute("aria-pressed", "true");
    expect(JSON.parse(localStorage.getItem("passage.prompter.v1")!)).toMatchObject({ wpm: 160, mirror: true });
  });

  it("closes on Escape", () => {
    const { onClose, script } = open();
    fireEvent.keyDown(script, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
