package documents

import (
	"bytes"
	stdhtml "html"
	htmltemplate "html/template"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/util"
)

var publicMarkdown = goldmark.New(
	goldmark.WithExtensions(extension.GFM),
	goldmark.WithRendererOptions(renderer.WithNodeRenderers(util.Prioritized(mermaidCodeBlockRenderer{}, 500))),
)

var publicTemplate = htmltemplate.Must(htmltemplate.New("public").Parse(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>{{ .Title }}</title>
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
  <style>
    :root {
      color-scheme: light dark;
      --bg: #fbfbf8;
      --ink: #1b1a17;
      --ink-soft: #363531;
      --muted: #8c897f;
      --hairline: #e8e6dd;
      --control-bg: rgba(251, 251, 248, 0.86);
      --code-bg: #f0efe8;
      --accent: #2c6b60;
      --measure: 40rem;
      --serif: Georgia, "Times New Roman", serif;
    }
    :root[data-theme="dark"] {
      color-scheme: dark;
      --bg: #111318;
      --ink: #f0f2f5;
      --ink-soft: #d5d9df;
      --muted: #969da8;
      --hairline: #363d47;
      --control-bg: rgba(17, 19, 24, 0.86);
      --code-bg: #1b1f26;
      --accent: #8aa89f;
    }
    :root[data-theme="light"] { color-scheme: light; }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) {
        color-scheme: dark;
        --bg: #111318;
        --ink: #f0f2f5;
        --ink-soft: #d5d9df;
        --muted: #969da8;
        --hairline: #363d47;
        --control-bg: rgba(17, 19, 24, 0.86);
        --code-bg: #1b1f26;
        --accent: #8aa89f;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
      transition: background 140ms ease, color 140ms ease;
    }
    .themeToggle {
      position: fixed;
      z-index: 1;
      top: 18px;
      right: 18px;
      display: grid;
      width: 36px;
      height: 36px;
      place-items: center;
      padding: 0;
      color: var(--muted);
      border: 1px solid transparent;
      border-radius: 50%;
      background: var(--control-bg);
      cursor: pointer;
      backdrop-filter: blur(10px);
    }
    .themeToggle:hover { color: var(--ink); }
    .themeToggle:focus-visible {
      border-color: var(--accent);
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .themeToggle svg {
      width: 17px;
      height: 17px;
      fill: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.6;
    }
    .themeToggle .sunIcon { display: none; }
    :root[data-theme="dark"] .themeToggle .moonIcon { display: none; }
    :root[data-theme="dark"] .themeToggle .sunIcon { display: block; }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) .themeToggle .moonIcon { display: none; }
      :root:not([data-theme="light"]) .themeToggle .sunIcon { display: block; }
    }
    main {
      max-width: var(--measure);
      margin: 0 auto;
      padding: 80px 22px 18vh;
      color: var(--ink-soft);
      font-size: clamp(1rem, 0.2vw + 0.97rem, 1.075rem);
      line-height: 1.75;
      letter-spacing: -0.003em;
    }
    h1, h2, h3, h4 {
      color: var(--ink);
    }
    h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
    h1 {
      max-width: 14ch;
      margin: 0 0 0.65em;
      font-family: var(--serif);
      font-size: clamp(2.75rem, 6vw, 4rem);
      font-weight: 400;
      line-height: 1.03;
      letter-spacing: -0.035em;
    }
    h2 {
      max-width: 22ch;
      margin: 4rem 0 0.7rem;
      font-family: var(--serif);
      font-size: clamp(1.65rem, 3vw, 2.15rem);
      font-weight: 400;
      line-height: 1.16;
      letter-spacing: -0.025em;
    }
    h1 + h2 { margin-top: 3.2rem; }
    h3 {
      margin: 2.6rem 0 0.55rem;
      font-size: 1.21rem;
      line-height: 1.35;
      letter-spacing: -0.011em;
    }
    h4 {
      margin: 1.6rem 0 0.45rem;
      font-size: 1.0625rem;
      line-height: 1.4;
    }
    p, ul, ol, blockquote, pre, table { margin: 0 0 1.25em; }
    h1 + p {
      max-width: 34rem;
      margin-bottom: 3.4rem;
      color: var(--muted);
      font-size: clamp(1.1rem, 0.35vw + 1rem, 1.2rem);
      line-height: 1.6;
      letter-spacing: -0.012em;
    }
    ul, ol { padding-left: 1.45em; }
    a { color: var(--accent); }
    code {
      background: var(--code-bg);
      border-radius: 4px;
      padding: 0.12em 0.28em;
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 0.9em;
    }
    pre {
      overflow-x: auto;
      background: var(--code-bg);
      border-radius: 8px;
      padding: 16px;
    }
    pre code {
      background: transparent;
      padding: 0;
      font-size: 0.88rem;
    }
    .mermaidFigure {
      margin: 1.8em 0;
      text-align: center;
    }
    .mermaidFigure svg {
      max-width: 100%;
      height: auto;
    }
    .mermaid {
      text-align: center;
    }
    img {
      max-width: 100%;
      height: auto;
    }
    blockquote {
      margin: 2.4rem 0;
      padding: 0.1em 0 0.1em 1.2em;
      color: var(--ink-soft);
      border-left: 2px solid var(--accent);
      font-family: var(--serif);
      font-size: 1.1em;
      line-height: 1.62;
    }
    hr {
      height: 1px;
      margin: 3.75rem 0;
      border: 0;
      background: var(--hairline);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.95rem;
    }
    th, td {
      border-bottom: 1px solid var(--hairline);
      padding: 8px 10px 8px 0;
      text-align: left;
    }
    th { color: var(--ink); }
    @media (max-width: 720px) {
      .themeToggle {
        top: 12px;
        right: 12px;
      }
      main { padding: 48px 22px 18vh; }
      h1 {
        max-width: 16ch;
        font-size: clamp(2.35rem, 12vw, 3.1rem);
      }
      h2 { font-size: clamp(1.55rem, 7vw, 1.9rem); }
    }
    @media (prefers-reduced-motion: reduce) {
      body { transition: none; }
    }
    @media print {
      :root,
      :root:not([data-theme="light"]),
      :root[data-theme="light"],
      :root[data-theme="dark"] {
        color-scheme: light;
        --bg: #fff;
        --ink: #1b1a17;
        --ink-soft: #363531;
        --muted: #6f716a;
        --hairline: #dcdad3;
        --control-bg: #fff;
        --code-bg: #f0efe8;
        --accent: #2c6b60;
      }
      body { transition: none; }
      .themeToggle { display: none; }
      :root[data-theme="dark"] .mermaid svg {
        filter: invert(1) hue-rotate(180deg);
      }
    }
    @media print and (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) .mermaid svg {
        filter: invert(1) hue-rotate(180deg);
      }
    }
  </style>
  <script src="/assets/public-theme.js"></script>
</head>
<body>
  <button class="themeToggle" type="button" aria-label="Use dark theme" title="Use dark theme">
    <svg class="moonIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 15.1A8.4 8.4 0 0 1 8.9 4a8.4 8.4 0 1 0 11.1 11.1Z" />
    </svg>
    <svg class="sunIcon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  </button>
  <main>{{ .Body }}</main>
  {{ if .HasMermaid }}
  <script type="module" src="/assets/public-mermaid.mjs"></script>
  {{ end }}
</body>
</html>`))

func renderPublicHTML(doc Document) ([]byte, error) {
	var rendered bytes.Buffer
	if err := publicMarkdown.Convert([]byte(doc.Body), &rendered); err != nil {
		return nil, err
	}
	var page bytes.Buffer
	err := publicTemplate.Execute(&page, struct {
		Title      string
		Body       htmltemplate.HTML
		HasMermaid bool
	}{
		Title:      doc.Title,
		Body:       htmltemplate.HTML(rendered.String()),
		HasMermaid: bytes.Contains(rendered.Bytes(), []byte(`class="mermaid"`)),
	})
	return page.Bytes(), err
}

type mermaidCodeBlockRenderer struct{}

func (r mermaidCodeBlockRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(ast.KindFencedCodeBlock, r.renderFencedCodeBlock)
}

func (r mermaidCodeBlockRenderer) renderFencedCodeBlock(
	w util.BufWriter, source []byte, node ast.Node, entering bool,
) (ast.WalkStatus, error) {
	n := node.(*ast.FencedCodeBlock)
	language := string(n.Language(source))
	if strings.EqualFold(strings.TrimSpace(language), "mermaid") {
		if entering {
			_, _ = w.WriteString(`<figure class="mermaidFigure"><div class="mermaid">`)
			writeEscapedCodeBlockLines(w, source, n)
		} else {
			_, _ = w.WriteString("</div></figure>\n")
		}
		return ast.WalkContinue, nil
	}

	if entering {
		_, _ = w.WriteString("<pre><code")
		if language != "" {
			_, _ = w.WriteString(` class="language-`)
			_, _ = w.WriteString(stdhtml.EscapeString(language))
			_, _ = w.WriteString(`"`)
		}
		_ = w.WriteByte('>')
		writeEscapedCodeBlockLines(w, source, n)
	} else {
		_, _ = w.WriteString("</code></pre>\n")
	}
	return ast.WalkContinue, nil
}

func writeEscapedCodeBlockLines(w util.BufWriter, source []byte, node ast.Node) {
	lines := node.Lines()
	for i := range lines.Len() {
		segment := lines.At(i)
		_, _ = w.WriteString(stdhtml.EscapeString(string(segment.Value(source))))
	}
}
