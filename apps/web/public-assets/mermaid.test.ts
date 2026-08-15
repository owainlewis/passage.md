const mermaidMock = vi.hoisted(() => {
  const sources: string[][] = [];
  return {
    sources,
    initialize: vi.fn(),
    run: vi.fn(async ({ nodes }: { nodes: HTMLElement[] }) => {
      sources.push(nodes.map((node) => node.textContent ?? ""));
      nodes.forEach((node) => {
        node.dataset.processed = "true";
        node.innerHTML = "<svg></svg>";
      });
    })
  };
});

vi.mock("mermaid", () => ({ default: mermaidMock }));

beforeEach(() => {
  vi.resetModules();
  mermaidMock.initialize.mockClear();
  mermaidMock.run.mockClear();
  mermaidMock.sources.length = 0;
  delete document.documentElement.dataset.theme;
  document.body.innerHTML = `<div class="mermaid">flowchart LR\nA --&gt; B</div>`;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("rerenders the original diagram source with the selected public theme", async () => {
  await import("./mermaid");

  expect(mermaidMock.initialize).toHaveBeenLastCalledWith({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "neutral"
  });
  expect(mermaidMock.sources).toEqual([["flowchart LR\nA --> B"]]);

  document.documentElement.dataset.theme = "dark";
  window.dispatchEvent(new Event("passage-theme-change"));

  await vi.waitFor(() => expect(mermaidMock.run).toHaveBeenCalledTimes(2));
  expect(mermaidMock.initialize).toHaveBeenLastCalledWith({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "dark"
  });
  expect(mermaidMock.sources).toEqual([
    ["flowchart LR\nA --> B"],
    ["flowchart LR\nA --> B"]
  ]);
});
