# Document API Contract

This is the stable HTTP contract for Passage document clients.

The CLI and agent clients should build against this document instead of server handlers.

Base URL examples use `http://localhost:8080` for local development.

Production examples should replace that with the hosted Passage origin.

## Stability

The stable API prefix is `/api/v1`.

The stable public share prefix is `/d`.

Field names in this document are stable for CLI and agent clients.

New fields may be added to JSON objects.

Clients should ignore unknown fields.

Existing browser session behavior is preserved.

API token bearer auth authenticates as the same user identity used by these document routes.

## Authentication

Saved document routes require an authenticated user.

Current auth uses the `passage_session` httpOnly cookie set by the browser login flow.

Future CLI auth will use:

```http
Authorization: Bearer <api-token>
```

API tokens are created, listed, and revoked through session-authenticated account endpoints.

API tokens grant full document API access for the owning user.

They do not grant token management access.

Anonymous requests to saved document routes return:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
```

```json
{"error":"authentication required"}
```

Public share routes do not require authentication.

## API Tokens

Token management routes require a signed-in browser session.

Bearer tokens are not accepted for token management routes.

### List API Tokens

```http
GET /api/v1/api-tokens
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "tokens": [
    {
      "id": "22222222-2222-2222-2222-222222222222",
      "name": "Laptop",
      "lastUsedAt": "2026-06-28T12:10:00Z",
      "createdAt": "2026-06-28T12:00:00Z"
    }
  ]
}
```

Revoked tokens are excluded.

The plaintext token value is never returned by this route.

### Create API Token

```http
POST /api/v1/api-tokens
Content-Type: application/json
```

Request:

```json
{"name":"Laptop"}
```

Response:

```http
HTTP/1.1 201 Created
Content-Type: application/json
```

```json
{
  "token": "psg_exampleplaintexttoken",
  "apiToken": {
    "id": "22222222-2222-2222-2222-222222222222",
    "name": "Laptop",
    "createdAt": "2026-06-28T12:00:00Z"
  }
}
```

The `token` value is shown once.

After this response, only hashed token material is stored.

### Revoke API Token

```http
DELETE /api/v1/api-tokens/{id}
```

Response:

```http
HTTP/1.1 204 No Content
```

After revoke, requests using the old bearer token return `401`.

## JSON Rules

Mutation requests with JSON bodies must send:

```http
Content-Type: application/json
```

Invalid JSON returns `400`.

Missing or non-JSON content type returns `415`.

Cross-origin browser mutations with an unexpected `Origin` header return `403`.

JSON error responses use this shape:

```json
{"error":"human readable message"}
```

Clients should treat the `error` value as user-facing text.

Clients should branch on HTTP status, not on exact error strings.

## Document Object

Document objects use this shape:

```json
{
  "id": "11111111-1111-1111-1111-111111111111",
  "title": "Example",
  "body": "# Example\n\nMarkdown body.",
  "shareToken": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "sharedAt": "2026-06-28T12:00:00Z",
  "createdAt": "2026-06-28T12:00:00Z",
  "updatedAt": "2026-06-28T12:00:00Z"
}
```

Fields:

- `id`: document UUID.
- `title`: server-derived title from the Markdown body.
- `body`: full Markdown body.
- `shareToken`: optional public share token.
- `sharedAt`: optional share creation timestamp.
- `createdAt`: creation timestamp.
- `updatedAt`: last update timestamp.
- `archivedAt`: omitted on active document responses.

`title` is derived from the first non-empty Markdown line.

If no title can be derived, the title is `Untitled`.

## List Documents

```http
GET /api/v1/docs
```

Returns active documents owned by the authenticated user.

Archived documents are excluded.

Documents are ordered by `updatedAt` descending.

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "documents": [
    {
      "id": "11111111-1111-1111-1111-111111111111",
      "title": "Example",
      "body": "# Example",
      "createdAt": "2026-06-28T12:00:00Z",
      "updatedAt": "2026-06-28T12:00:00Z"
    }
  ]
}
```

Pagination is deferred for the MVP.

The MVP response always returns all active documents for the user.

## Create Document

```http
POST /api/v1/docs
Content-Type: application/json
```

Request:

```json
{"body":"# New document\n\nMarkdown body."}
```

Response:

```http
HTTP/1.1 201 Created
Content-Type: application/json
```

```json
{
  "id": "11111111-1111-1111-1111-111111111111",
  "title": "New document",
  "body": "# New document\n\nMarkdown body.",
  "createdAt": "2026-06-28T12:00:00Z",
  "updatedAt": "2026-06-28T12:00:00Z"
}
```

Request rules:

- If `body` is omitted, the server treats it as an empty string.
- Empty `body` is accepted and creates an `Untitled` document.

## Read Document

```http
GET /api/v1/docs/{id}
```

Returns one active document owned by the authenticated user.

Malformed UUIDs, archived documents, missing documents, and documents owned by another user all return `404`.

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "id": "11111111-1111-1111-1111-111111111111",
  "title": "Example",
  "body": "# Example",
  "createdAt": "2026-06-28T12:00:00Z",
  "updatedAt": "2026-06-28T12:00:00Z"
}
```

## Update Document

```http
PATCH /api/v1/docs/{id}
Content-Type: application/json
```

Request:

```json
{"body":"# Revised document\n\nUpdated Markdown body."}
```

`PATCH` replaces the full Markdown body.

CLI append behavior should read the current body, append client-side, then send the full replacement body.

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "id": "11111111-1111-1111-1111-111111111111",
  "title": "Revised document",
  "body": "# Revised document\n\nUpdated Markdown body.",
  "createdAt": "2026-06-28T12:00:00Z",
  "updatedAt": "2026-06-28T12:05:00Z"
}
```

Malformed UUIDs, archived documents, missing documents, and documents owned by another user all return `404`.

## Archive Document

```http
DELETE /api/v1/docs/{id}
```

Archives an owned active document.

Archived documents are hidden from list, read, update, share, and public lookup.

Response:

```http
HTTP/1.1 204 No Content
```

Malformed UUIDs, archived documents, missing documents, and documents owned by another user all return `404`.

## Share Document

```http
POST /api/v1/docs/{id}/share
```

Creates or reuses a public share token for an owned active document.

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "token": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "htmlPath": "/d/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "markdownPath": "/d/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md"
}
```

The paths are relative to the same origin.

CLI clients may turn them into absolute URLs by joining them with the configured API base origin.

Malformed UUIDs, archived documents, missing documents, and documents owned by another user all return `404`.

## Unshare Document

```http
DELETE /api/v1/docs/{id}/share
```

Revokes public access for an owned active document.

Response:

```http
HTTP/1.1 204 No Content
```

After unshare, the previous HTML and raw Markdown URLs return `404`.

Malformed UUIDs, archived documents, missing documents, and documents owned by another user all return `404`.

## Public HTML

```http
GET /d/{token}
```

Returns a read-only rendered HTML page for a shared document.

Response:

```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Cache-Control: no-store
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
```

Missing, malformed, revoked, or archived shares return `404`.

The HTML route is for humans.

Agents should prefer the raw Markdown route.

## Public Raw Markdown

```http
GET /d/{token}.md
```

Returns the exact Markdown body for a shared document.

Response:

```http
HTTP/1.1 200 OK
Content-Type: text/markdown; charset=utf-8
Cache-Control: no-store
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
```

Response body:

```md
# Example

Markdown body.
```

Missing, malformed, revoked, or archived shares return `404`.

## Status Summary

- `200`: successful read, update, or share.
- `201`: document created.
- `204`: document archived or unshared.
- `400`: invalid JSON.
- `401`: authentication required.
- `403`: cross-origin mutation blocked.
- `404`: document or public share not found.
- `415`: create or update request was not JSON.
- `500`: unexpected server failure.
- `503`: database-backed service is not configured.

## MVP Deferrals

Pagination is deferred.

API token UI is defined in a separate issue.

Search is deferred.

Version history is deferred.

Document append is a CLI operation built from read plus update.
