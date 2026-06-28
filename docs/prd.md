# passage.md PRD

## Summary

`passage.md` is a Markdown notepad for agents and humans.

It starts as a clean browser writing surface for transient Markdown.

It should feel like GitHub Gist with better writing, better preview, and better agent workflows.

The first version is for Owain's own workflow and for validating the product shape.

Saving, sharing, CLI access, API access, and payments come in later phases.

## Homepage Tag

A Markdown notepad for agents and humans.

## Product Reference

GitHub Gist is the functional reference.

iA Writer is the visual reference.

The editor should feel quiet, focused, and almost empty.

The preview should feel like a finished document.

## Problem

Markdown is still the simplest portable format for scripts, specs, prompts, diagrams, and agent context.

GitHub is useful for code but clumsy for quick thinking and writing.

Most Markdown apps are built for humans first and agents later.

Agents need docs that are easy to create, fetch, append, replace, and share as raw Markdown.

The first problem to solve is simpler.

Owain needs a polished local Markdown scratchpad that can become the foundation for saved docs, CLI workflows, and sharing.

## Users

Primary users:

- Owain writing notes, scripts, specs, prompts, and architecture docs.
- Developers writing transient Markdown in a calm browser surface.
- AI coding agents that need reliable Markdown context later.
- Technical founders who want simple shareable Markdown without repo friction later.

Secondary users:

- Writers who prefer Markdown.
- Teams that need lightweight shared technical notes later.

## Positioning

`passage.md` is a minimal Markdown notepad.

It is browser-first for humans.

It becomes CLI-first for agents once persistence exists.

It is not a full knowledge base.

It is not a rich-text editor.

It is not a docs platform with heavy permissions in V1.

## Product Model By Phase

### Phase 1: Local Server-Backed App

- Open the browser editor.
- Write Markdown.
- Preview Markdown.
- Preview Mermaid diagrams.
- Keep a transient local draft.
- Copy Markdown from the editor.
- Sign up and sign in with email/password.
- Save private documents to local Postgres.
- Reopen, autosave, list, and archive saved documents.
- Share saved documents with explicit read-only links.
- Read shared documents as human HTML or raw `.md`.
- Anonymous local writing still works with no account.
- No CLI.
- No hosted deployment requirement.

### Phase 2: Deployed Server-Backed App

- Deploy the server-backed app to GCP.
- Add production build, container, HTTPS, domain, and smoke tests.
- Do not deploy production during Phase 1.

### Phase 3: Email Auth Flows

- Add password reset emails.
- Add magic-link sign-in.
- Reuse the same session core.
- Do not add OAuth yet.

### Phase 4: Payments And Public Paid Tier

- Add Stripe Checkout and Billing.
- Add paid entitlements.
- Let free accounts save up to 5 hosted docs.
- Let free accounts use the CLI against those 5 hosted docs.
- Let paid users save more docs, sync, export, share, and use higher-limit CLI/API workflows.
- Add paid appearance features such as dark mode and themes.
- Keep anonymous users limited to transient browser drafts and anonymous fragment sharing.

## Core UX

The default screen is a writing surface.

There should be no dashboard feeling inside the editor.

The editor has a thin top bar, centered title, and minimal actions.

The bottom bar can show mode, word count, local save state, and small controls.

`Ctrl+R` switches between edit and view mode.

`Cmd+R` does the same on macOS.

Edit mode shows raw Markdown.

View mode shows rendered Markdown.

The default early experience is edit or view, not split view.

Split view can come later.

## Anonymous Drafts

Anonymous drafts are stored only in browser storage.

Anonymous drafts do not touch the database.

Anonymous drafts should survive refresh in the same browser.

Anonymous drafts can be cleared by the user.

Anonymous users can copy Markdown from the editor.

File export is part of the paid tier once payments exist.

## Saved Documents

Phase 1 adds saved documents for local use.

Phase 4 turns saved documents into the paid product boundary.

All saved docs are private by default.

A doc becomes public only when the owner shares it.

Anyone with the shared URL can read the doc.

Anyone with the shared URL cannot edit the doc in the first sharing model.

Unsharing disables public access.

Private docs return 404 from public routes.

## Public URLs

Human HTML view:

```txt
https://passage.md/d/share_abc123
```

Raw Markdown view:

```txt
https://passage.md/d/share_abc123.md
```

The raw `.md` route is required once sharing exists because agents need stable Markdown context URLs.

Durable server share links are a paid feature.

Paid share pages should be unbranded.

They should not show Passage navigation, upgrade prompts, product marketing, or visible app branding.

The page should feel like the user's document.

Anonymous fragment share links can stay free because they do not touch the backend and help people understand the product.

## Anonymous Sharing

Anonymous users can share a document before any account or server exists.

The share link carries the document inside the URL fragment after the `#`.

The fragment stays in the browser and never reaches a server.

This keeps the document private to whoever holds the link with no backend.

The shared view renders the document only, with no sidebar and no editor chrome.

The anonymous share route is:

```txt
https://passage.md/d#<encoded-markdown>
```

Large documents produce long links, so this model suits the anonymous tier.

Saved documents move to opaque token links once accounts and the server exist.

The server share routes stay `https://passage.md/d/<token>` and `https://passage.md/d/<token>.md`.

The shared view is the same in both models, so only the data source changes.

Shared HTML must be sanitized before this ships publicly because a crafted link can carry hostile Markdown.

## Pricing And Storage

Decision date: 2026-06-27.

The pricing model is:

| Plan | Price | Boundary |
| --- | --- | --- |
| Free | `$0` | 5 saved hosted docs. |
| Pro monthly | `$6.99/month` | Unlimited saved docs with fair use. |
| Pro annual | `$59/year` launch target, or `$69/year` standard target. | Same as Pro monthly with a discount. |

The free tier should include the full basic workflow on a small number of docs.

Free users can:

- Write Markdown in the browser.
- Preview Markdown.
- Copy Markdown.
- Keep local drafts.
- Save up to 5 hosted docs.
- Use the CLI with those 5 hosted docs.
- Use anonymous fragment share links.
- Edit existing saved docs after reaching the 5 doc limit.

Free users cannot create a 6th hosted doc until they upgrade or delete an existing saved doc.

The paid tier starts when the user wants to make passage.md their writing system.

Pro users get:

- Unlimited saved docs with fair use.
- Sync.
- Dark mode.
- Additional writing themes.
- File export.
- Durable public share links.
- Raw `.md` share URLs for agents.
- Higher CLI/API limits.
- Agent skill support.
- Unbranded public share pages.

Do not make free mode feel broken.

Free mode should be useful as a small hosted writing workflow.

Paid mode starts when users want more than 5 docs, durable publishing, higher agent usage, portability, or customization.

The pricing posture should be cheap enough that upgrading feels obvious once someone likes the app.

The product story is:

```txt
Free gives you the full workflow on 5 docs.
Pro makes it your writing system.
```

The CLI is part of the product wedge.

Do not hide the CLI entirely behind Pro.

Free CLI support should prove the agent workflow on the same 5 hosted docs.

Pro should expand the volume, limits, sharing, export, and customization.

The model is a small useful product with a low monthly price, high daily utility, and quiet stickiness from saved docs and agent workflows.

Do not add heavy enterprise packaging for V1.

Do not make the paid tier feel expensive for an individual user.

Billing uses Stripe Checkout and Stripe Billing.

Offer one Pro product with a monthly price and an annual price.

The annual price should save about twenty to thirty percent.

A one time lifetime price is an optional launch promotion.

Internal fair use can be enforced even if the UI says unlimited.

A reasonable internal Pro cap is 10,000 docs and a 1 MB limit per doc until real usage suggests otherwise.

Set limits as anti abuse guardrails, not as a storage meter.

Cap each document at one megabyte, which is very large for Markdown.

Treat saved document counts as effectively unlimited under fair use.

Markdown text is cheap to store relative to subscription revenue.

Ten million documents at a realistic ten kilobytes each is about one hundred gigabytes raw.

Postgres compresses Markdown text, so stored size is smaller again.

Storage cost at that scale is tens of dollars per month, which is small against paid revenue.

Price on access and value, not on bytes.

## CLI

The CLI is part of the saved-doc product.

It should arrive in Phase 3 after the document API exists.

It should work well in terminals, shell scripts, and coding-agent sessions.

Free accounts can use the CLI with their 5 hosted docs.

Pro accounts get higher CLI/API limits and more hosted docs.

Core commands:

```sh
passage auth login
passage new "Launch script"
passage list
passage push script.md
passage pull doc_123
passage cat doc_123
passage append doc_123 notes.md
passage replace doc_123 script.md
passage share doc_123
passage unshare doc_123
passage url doc_123
passage raw doc_123
passage open doc_123
```

The CLI should output plain text by default.

It should support JSON output for agents and scripts.

## Phase 1 Requirements

- Anonymous users can write in the browser without an account.
- Anonymous drafts persist locally in the browser.
- Anonymous users can clear the local draft.
- Anonymous users can export Markdown.
- Edit mode shows raw Markdown.
- View mode renders Markdown.
- View mode renders Mermaid diagrams.
- Invalid Mermaid shows a readable inline error.
- The editor feels calm and uncluttered.
- The local MVP runs with one documented command path.
- Tests cover the core editor, local draft, export, preview, and keyboard shortcut behavior.

## Later Requirements

- Authenticated personal users can create saved docs.
- Saved docs can autosave.
- Saved docs can be listed, searched, opened, archived, and exported.
- Shared docs have public HTML and raw Markdown URLs.
- The CLI can authenticate and perform the core document commands.
- Server-side authorization enforces private docs, sharing, API access, and paid boundaries once those features exist.

## Non-Goals For The Early MVP

- User accounts.
- Database save.
- Paid tiers.
- Stripe.
- CLI.
- Public share URLs.
- Realtime collaboration.
- Team workspaces.
- Rich-text editing.
- Full permissions.
- Comments.
- Mobile apps.
- Offline sync across devices.
- Import from GitHub.
- AI generation inside the app.

## Success Criteria

- A user can open `passage.md` locally and write Markdown immediately.
- The editor feels calm and uncluttered.
- A Markdown draft survives refresh in the same browser.
- A user can switch between edit and view modes without losing text.
- A user can export a `.md` file.
- Mermaid diagrams render in preview mode.
- The local MVP runs with one documented command path.
- The repo has an agent-ready plan for the next phases.
