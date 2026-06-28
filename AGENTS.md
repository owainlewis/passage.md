# AGENTS.md

Guidance for AI agents and contributors working in this repository.

## What This Is

`passage.md` is a Markdown notepad for people writing with AI agents and humans.

The product is intentionally small.

Free users can write transient Markdown in the browser.

Paid users can save docs, share docs by URL, and use the CLI/API.

V1 AI support means plain Markdown storage, raw `.md` URLs, API access, and CLI access that agents can consume.

In-app AI writing and real-time collaboration are out of scope unless GitHub issues explicitly add them.

## Product Principles

- Keep the writing surface calm and minimal.
- Copy the restraint of iA Writer without copying its brand.
- Treat the CLI as a first-class product surface.
- Store saved documents as plain Markdown.
- Make private the default.
- Make public sharing explicit.
- Make raw `.md` URLs easy for agents to consume.

## Engineering Principles

- Make the smallest complete change.
- Prefer boring infrastructure.
- Prefer vertical slices over layer-by-layer work.
- Keep auth, billing, sharing, and persistence server-enforced.
- Do not add collaboration until the V1 share model is shipped.
- Do not add complex rich-text behavior.

## Planned Stack

- Web: Next.js, React, TypeScript.
- API: Go HTTP server.
- CLI: Go.
- Database: Postgres.
- Billing: Stripe Checkout and Billing.
- Editor: CodeMirror 6.
- Markdown preview: remark, rehype, remark-gfm, Mermaid.
- Deployment: one Go server/container on GCP Cloud Run with the static Next.js frontend embedded.
- Database: local Postgres in development and managed Postgres in production via `DATABASE_URL`.

## Quality Bar

Every implementation issue should include:

- A clear goal.
- Context and relevant docs.
- Acceptance criteria.
- Concrete verification steps.
- Explicit out-of-scope notes.

## GitHub Workflow

Use the GitHub CLI, `gh`, for GitHub Issues and Projects work in this repo.

Repository:

- `owainlewis/passage.md`
- URL: `https://github.com/owainlewis/passage.md`

Project:

- Owner: `owainlewis`
- Project number: `14`
- Title: `passage.md MVP`
- URL: `https://github.com/users/owainlewis/projects/14`
- Status field options: `Todo`, `In Progress`, `Done`

Useful commands:

```sh
gh issue list --repo owainlewis/passage.md --state all --limit 100
gh issue view <number> --repo owainlewis/passage.md
gh project item-list 14 --owner owainlewis --limit 100
gh project field-list 14 --owner owainlewis
```

Treat GitHub Issues and the project board as the live execution tracker.

The project board is the single source of truth for priority and status.

The GitHub issue body is the single source of truth for scope, acceptance criteria, dependencies, verification, and out-of-scope notes.

Local docs are product and architecture notes only.

They are not the roadmap.

If local docs conflict with GitHub Issues, the GitHub issue wins.

`plan.md` is only a pointer to GitHub.

It is not a local issue plan.

When picking work:

- Prefer `Todo` items with the `agent-ready` label.
- Skip `blocked` items unless Owain explicitly asks for them.
- Read the full issue before changing code.
- Honor dependencies listed in the issue body.
- Move only the active issue to `In Progress`.
- Keep finished evidence in the issue or PR, not in a local roadmap file.

## Writing Style

Be concise, direct, and useful.

Explain simply.

Never use em dashes.

Use one sentence per line in long Markdown.
