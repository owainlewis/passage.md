import mermaid from "mermaid";

const diagrams = Array.from(document.querySelectorAll<HTMLElement>(".mermaid"));
const sources = diagrams.map((diagram) => diagram.textContent ?? "");
let rendering = false;
let renderQueued = false;

function darkThemeActive() {
  const selected = document.documentElement.dataset.theme;
  return selected === "dark" || (selected !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

async function renderDiagrams() {
  if (rendering) {
    renderQueued = true;
    return;
  }

  rendering = true;
  try {
    do {
      renderQueued = false;
      diagrams.forEach((diagram, index) => {
        diagram.removeAttribute("data-processed");
        diagram.textContent = sources[index];
      });

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: darkThemeActive() ? "dark" : "neutral"
      });

      await mermaid.run({ nodes: diagrams });
    } while (renderQueued);
  } finally {
    rendering = false;
  }
}

window.addEventListener("passage-theme-change", () => void renderDiagrams());
await renderDiagrams();
