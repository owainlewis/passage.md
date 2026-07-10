# passage.md Product Notes

## Source Of Truth

GitHub Issues and project board 14 are the source of truth for roadmap, phase order, issue scope, acceptance criteria, dependencies, verification, and status.

This document is not a roadmap.

If this document conflicts with a GitHub issue, the GitHub issue wins.

## Summary

`passage.md` is a hosted Markdown workspace for humans and agents.

It is a calm browser place to write Markdown, save it online, share it by URL, and let agents work with the same documents through raw Markdown, CLI, and API workflows.

It is not trying to be a local Markdown editor, a personal knowledge base, or a heavy team workspace.

## Problem

Markdown is still the simplest portable format for scripts, specs, prompts, diagrams, and agent context.

Local Markdown files are useful, but they become messy when the same document needs to move between a browser, a phone, another person, and an agent.

Google Docs is too rich for Markdown.

Notion is too heavy for a simple document.

GitHub Gists are useful, but they are developer plumbing, not a calm writing surface.

Passage exists for hosted, URL-native Markdown.

## Product Positioning

The product promise is:

```txt
Hosted Markdown for humans and agents.
```

The core workflow is:

1. Write Markdown in the browser.
2. Save private hosted docs.
3. Share docs online by URL.
4. Expose raw `.md` URLs for agents.
5. Use the CLI and API for terminal and agent workflows.

## Users

Primary users:

- Owain writing notes, scripts, specs, prompts, and architecture docs.
- Developers writing Markdown in a calm browser surface.
- AI coding agents that need reliable Markdown context.
- Technical founders who want shareable Markdown without repo friction.

Secondary users:

- Writers who prefer Markdown.
- Small teams that need lightweight shared technical notes.

## Product Principles

- Keep the writing surface calm and minimal.
- Store saved documents as plain Markdown.
- Make private the default.
- Make public sharing explicit.
- Make raw `.md` URLs easy for agents to consume.
- Treat the CLI as a first-class product surface.
- Avoid local-file ceremony as the core product model.
- Do not become a full knowledge base.
- Do not become a rich-text editor.
- Do not become a project management tool.
- Do not add in-app AI writing unless a GitHub issue explicitly scopes it.
- Do not add real-time collaboration until the simple share model is excellent.

## Core UX

The default screen is a writing surface.

The editor should feel quiet, focused, and almost empty.

The preview should feel like a finished document.

Edit mode shows raw Markdown.

Preview mode renders Markdown.

Preview should support:

- Headings.
- Paragraphs.
- Lists.
- Links.
- Blockquotes.
- Tables.
- Code blocks.
- Inline code.
- Mermaid fenced blocks.

Invalid Markdown should still save.

Invalid Mermaid should render as an inline preview error and should not break the rest of the document.

## Saved Documents

Saved docs are private by default.

A doc becomes public only when the owner shares it.

Anyone with the shared URL can read the doc.

Anyone with the shared URL cannot edit the doc in the first sharing model.

Unsharing disables public access.

Private or unshared public docs return 404 from public routes.

Human HTML view:

```txt
https://passage.md/d/abcdefghijklmnopqrstuv
```

Raw Markdown view:

```txt
https://passage.md/d/abcdefghijklmnopqrstuv.md
```

The raw `.md` route is required because agents need stable Markdown context URLs.

## CLI

The CLI is part of the product wedge.

It should work well in terminals, shell scripts, and coding-agent sessions.

Core commands should include:

```sh
passage login
passage new "Launch notes"
passage list
passage cat <doc>
passage pull <doc>
passage push <doc> <file>
passage append <doc> <file>
passage replace <doc> <file>
passage share <doc>
passage unshare <doc>
passage raw <doc>
```

The CLI should output plain text by default.

It should support JSON output for agents and scripts.

The CLI should primarily operate on hosted Passage docs, not local Markdown vaults.

## Pricing Direction

Free should prove the hosted writing and agent workflow on a small number of docs.

Pro should make Passage a durable writing system.

The current pricing direction is:

| Plan | Price | Boundary |
| --- | --- | --- |
| Free | `$0` | Small hosted workflow. |
| Pro monthly | `$6.99/month` | More docs, higher limits, and paid features. |
| Pro annual | `$59/year` launch target, or `$69/year` standard target. | Same as Pro monthly with a discount. |

Exact paid boundaries live in GitHub Issues.

Do not treat this pricing section as implementation scope.
