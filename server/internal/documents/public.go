package documents

import (
	"bytes"
	"html/template"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
)

var publicMarkdown = goldmark.New(
	goldmark.WithExtensions(extension.GFM),
)

var publicTemplate = template.Must(template.New("public").Parse(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ .Title }}</title>
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
  <style>
    :root {
      color-scheme: light;
      --bg: #fbfbf8;
      --ink: #1b1a17;
      --muted: #8c897f;
      --hairline: #e8e6dd;
      --code-bg: #f0efe8;
      --accent: #2c6b60;
      --measure: 42rem;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    header {
      min-height: 52px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 0 22px;
      border-bottom: 1px solid var(--hairline);
      color: var(--muted);
      font-size: 0.78rem;
    }
    .brand { font-weight: 650; color: var(--ink); }
    main {
      max-width: var(--measure);
      margin: 0 auto;
      padding: 52px 22px 76px;
      font-size: 1.125rem;
      line-height: 1.7;
    }
    h1, h2, h3, h4 {
      line-height: 1.2;
      margin: 2.2em 0 0.7em;
    }
    h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
    h1 { font-size: 2.125rem; }
    h2 { font-size: 1.5rem; }
    h3 { font-size: 1.21rem; }
    p, ul, ol, blockquote, pre, table { margin: 0 0 1.25em; }
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
    blockquote {
      border-left: 3px solid var(--hairline);
      padding-left: 18px;
      color: #36342f;
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
  </style>
</head>
<body>
  <header>
    <span class="brand">passage.md</span>
    <span>Shared document</span>
  </header>
  <main>{{ .Body }}</main>
</body>
</html>`))

func renderPublicHTML(doc Document) ([]byte, error) {
	var rendered bytes.Buffer
	if err := publicMarkdown.Convert([]byte(doc.Body), &rendered); err != nil {
		return nil, err
	}
	var page bytes.Buffer
	err := publicTemplate.Execute(&page, struct {
		Title string
		Body  template.HTML
	}{
		Title: doc.Title,
		Body:  template.HTML(rendered.String()),
	})
	return page.Bytes(), err
}
