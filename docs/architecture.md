# passage.md Architecture

## Source Of Truth

GitHub Issues and project board 14 are the source of truth for roadmap, phase order, issue scope, acceptance criteria, dependencies, verification, and status.

This document records durable architecture decisions only.

If this document conflicts with a GitHub issue, the GitHub issue wins.

## Stack

- Web: Next.js, React, TypeScript.
- Editor: CodeMirror 6 when the editor needs richer behavior.
- Markdown preview: sanitized Markdown with Mermaid support.
- API: Go HTTP server.
- CLI: Go, in the public `owainlewis/passage-cli` repo.
- Database: Postgres.
- Billing: Stripe Checkout and Stripe Billing.
- Deployment: one Go server/container on GCP Cloud Run with the static Next.js frontend embedded.
- Production database: Cloud SQL for Postgres via `DATABASE_URL`.

## Runtime Shape

The Go server serves the static Next export and the JSON API from one origin.

The app uses Postgres for server-backed auth, saved documents, share links, and API tokens.

Local development also uses Postgres through `DATABASE_URL`.

The Next development server is only for frontend-only UI iteration.

It is not the local acceptance path.

## Web App

The web app owns the editor, preview, local draft persistence, account UI, and browser document workflows.

Anonymous mode can store transient drafts in browser storage.

Signed-in users save documents to Postgres through the Go API.

The editor should not feel like a dashboard.

## API

The API owns server-side truth for:

- Health.
- Email/password auth.
- Sessions.
- Saved document CRUD.
- Ownership checks.
- Public share links.
- Raw Markdown routes.
- API tokens.
- Future billing entitlements.

Current route shape:

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
GET    /api/v1/api-tokens
POST   /api/v1/api-tokens
DELETE /api/v1/api-tokens/:id
GET    /d/:publicId
GET    /d/:publicId.md
```

Stable CLI contract changes are tracked in GitHub Issues.

Do not add route-level scope here when a ticket owns the exact contract.

## Data Model

Current and expected core tables:

```txt
users
sessions
documents
document_shares
api_tokens
schema_migrations
```

Likely future tables:

```txt
subscriptions
```

Exact migrations live in `server/internal/migrations`.

Ticket-specific data model changes belong in the GitHub issue and PR.

## Auth And Access

Browser auth uses signed, httpOnly sessions.

CLI and agent auth should use bearer API tokens.

Private document access requires an authenticated owner.

Unauthorized access to another user's private document should not reveal existence.

Private or unshared public docs return 404 from public routes.

Unauthenticated private API requests return 401.

Entitlement and billing behavior is server-enforced.

## Sharing

Saved docs are private by default.

Owners can explicitly share saved documents by public ID URL.

Shared documents have:

- A human HTML route.
- A raw Markdown `.md` route.

Unsharing revokes both public routes.

Public shared docs do not require auth.

Shared Markdown rendering must be sanitized.

## Error Behavior

Invalid Markdown should still save because Markdown is text.

Invalid Mermaid should render as an inline preview error without blocking save.

Unauthenticated private API requests return 401.

Unauthorized document access returns 404 when revealing existence would leak private data.

Invalid or revoked API tokens should return 401.

Paid-only operations should return 402 once billing is enforced.

## Local Development

Local app acceptance uses the Go server and Postgres:

```sh
createdb passage_dev
export DATABASE_URL='postgres://localhost:5432/passage_dev?sslmode=disable'
export SESSION_SECRET='dev-session-secret-change-me'
just migrate
just dev
```

The app runs at `http://localhost:3000`.

Health should report:

```json
{"database":"ok","status":"ok"}
```
