# passage.md Architecture

## Summary

Use a boring stack and grow it in phases.

Phase 1 is now the local server-backed app.

It adds the Go server, local Postgres, email/password sessions, user-scoped saved docs, share links, and raw `.md` URLs.

Phase 2 deploys the server-backed app to GCP.

Phase 3 adds email auth flows such as password reset and magic links.

Phase 4 adds Stripe, Pro limits, and the public paid tier.

## Stack

- Web: Next.js, React, TypeScript.
- Editor: CodeMirror 6.
- Markdown preview: remark, rehype, remark-gfm, Mermaid.
- API: Go HTTP server, added when saved docs start.
- CLI: Go, added when saved docs start.
- Database: Postgres, added when saved docs start.
- Billing: Stripe Checkout and Stripe Billing, added after the personal saved-doc phase.
- Public rendering: server-side sanitized HTML once public sharing exists.
- Deployment: GCP Cloud Run.
- Database hosting: Cloud SQL for Postgres once persistence exists.

## Why This Stack

Next.js gives a strong browser app without much ceremony.

CodeMirror 6 gives a proper Markdown editor without building editor behavior from scratch.

Go is a good fit for the API and CLI once the product needs persistence and agent workflows.

Postgres is enough for users, docs, search, versions, billing state, and API tokens.

Cloud Run keeps operational complexity low.

Stripe gives the fastest path to paid save and sync when the public paid tier is ready.

## Phase 1 Shape

Phase 1 ships as a local browser app backed by one Go HTTP server and local Postgres.

The Go server serves the static Next export and the JSON API from one origin.

The Next development server can still be used for browser UI work.

Anonymous users keep the local scratchpad flow in browser storage.

Signed-in users can save documents to Postgres.

Saved documents are scoped to their owner and private by default.

Owners can explicitly share saved documents by opaque URL.

Shared documents have a human HTML route and a raw Markdown `.md` route.

Phase 1 auth is email/password only.

Password reset emails, magic links, OAuth, API tokens, CLI, billing, and production deployment are out of scope.

Phase 1 directories:

```txt
apps/web
server
docs
```

Optional Phase 1 directories:

```txt
packages/markdown
packages/ui
```

Only add shared packages if they remove real duplication.

## Web App

The web app owns the editor, preview, export, local draft persistence, and keyboard shortcuts.

The default route should be the writing surface.

There should be no dashboard feeling inside the editor.

Anonymous mode stores the current document locally in the browser.

The editor should be built so its state can later be connected to saved docs.

## Markdown Rendering

Edit mode shows raw Markdown.

View mode renders sanitized Markdown.

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

Invalid Markdown should still render as normal text where possible.

Invalid Mermaid should render as an inline preview error and should not break the rest of the document.

Raw Markdown export must preserve the original source.

## Local Draft Storage

Use browser storage for the anonymous draft.

The initial implementation can use `localStorage`.

Store enough metadata for a calm user experience:

- Draft body.
- Last edited timestamp.
- Optional title.

Do not send anonymous drafts to a server.

Do not introduce an account concept in Phase 1.

## Phase 1 API

The API owns server-side truth for signed-in saved docs.

It exposes health, email/password auth, document CRUD, content replace, public share, and raw Markdown.

It must enforce private docs.

Browser saved-doc flows use this API.

Suggested routes:

```txt
GET    /api/health
GET    /api/v1/me
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
GET    /api/v1/docs
POST   /api/v1/docs
GET    /api/v1/docs/:id
PATCH  /api/v1/docs/:id
DELETE /api/v1/docs/:id
POST   /api/v1/docs/:id/share
DELETE /api/v1/docs/:id/share
GET    /d/:token
GET    /d/:token.md
```

Legacy route names from earlier docs are not binding for Phase 1:

```txt
GET    /api/v1/documents
POST   /api/v1/documents
GET    /api/v1/documents/:id
PATCH  /api/v1/documents/:id
GET    /api/v1/documents/:id/content
PUT    /api/v1/documents/:id/content
DELETE /api/v1/documents/:id
POST   /api/v1/documents/:id/share
DELETE /api/v1/documents/:id/share
```

## Later CLI

The CLI is a core product surface, but it is not part of Phase 1.

It should use the same document backend once API-token auth exists.

## Suggested Data Model

The database starts in Phase 3.

### users

- `id`
- `email`
- `password_hash`
- `created_at`
- `updated_at`

### documents

- `id`
- `owner_user_id`
- `public_id`
- `title`
- `body`
- `is_public`
- `public_token`
- `archived_at`
- `created_at`
- `updated_at`

### sessions

- `id`
- `user_id`
- `token_hash`
- `expires_at`
- `created_at`

### document_versions

Document versions are not required in Phase 1.

- `id`
- `document_id`
- `body`
- `created_at`
- `created_by`

### api_tokens

API tokens are not required in Phase 1.

- `id`
- `user_id`
- `name`
- `token_hash`
- `last_used_at`
- `created_at`
- `revoked_at`

### subscriptions

Subscriptions start in Phase 4.

- `id`
- `user_id`
- `stripe_customer_id`
- `stripe_subscription_id`
- `status`
- `current_period_end`
- `created_at`
- `updated_at`

## Auth And Entitlements

Phase 1 has email/password auth for saved docs.

Phase 2 deploys that same app.

Phase 3 adds email-based auth flows.

Phase 4 adds public paid entitlements.

Reading and writing private docs requires auth once private docs exist.

Creating saved docs requires the personal allowlist in Phase 3.

Creating saved docs requires an active paid entitlement in Phase 4.

Replacing saved doc content requires the same entitlement check.

Sharing docs requires the same entitlement check.

Exporting saved docs requires the same entitlement check once payments exist.

Durable server share links require the same entitlement check once payments exist.

Anonymous fragment share links can remain free because they do not create server state.

Public shared docs do not require auth.

Paid public share pages should render without visible Passage branding, navigation, upgrade prompts, or product marketing.

CLI/API token access requires the same entitlement check.

Dark mode and additional writing themes require an active paid entitlement once payments exist.

## Error Behavior

Private or unshared public docs return 404 from public routes.

Unauthenticated private API requests return 401.

Authenticated users without access receive 403 during the personal allowlist phase.

Authenticated users without paid access receive 402 once payments exist.

Unauthorized access to another user's private document returns 404.

Invalid Markdown should still save because Markdown is text.

Invalid Mermaid should render as an inline preview error without blocking save.

## Local Development

Phase 1 should document one local path for:

- Web app install.
- Web app dev server.
- Web app tests.
- Browser smoke test.

Phase 3 should add one local path for:

- API server.
- CLI.
- Postgres.
- Migrations.
- API tests.
- CLI tests.

Docker Compose is acceptable for local Postgres once persistence exists.

## Deployment

Phase 2 deploys the anonymous editor to GCP.

Expected services:

- Cloud Run for the web runtime or static-serving container.
- Secret Manager only if runtime secrets are needed.
- Artifact Registry for container images.
- Cloud Build or GitHub Actions for build and deploy.

Phase 3 adds:

- Cloud Run for the Go API.
- Cloud SQL for Postgres.
- Secret Manager for database credentials and auth secrets.

Phase 4 adds:

- Stripe secrets.
- Stripe webhook handling.
- Billing portal configuration.

Owain will create the GCP project and provide project IDs, domains, and secrets when needed.
