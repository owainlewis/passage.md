import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "neutral"
});

await mermaid.run({ querySelector: ".mermaid" });
