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

Browser auth uses the `passage_session` httpOnly cookie set by the browser login flow.

CLI and agent clients use bearer API tokens:

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
  "publicId": "abcdefghijklmnopqrstuv",
  "title": "Example",
  "body": "# Example\n\nMarkdown body.",
  "sharedAt": "2026-06-28T12:00:00Z",
  "passwordProtected": false,
  "createdAt": "2026-06-28T12:00:00Z",
  "updatedAt": "2026-06-28T12:00:00Z"
}
```

Fields:

- `id`: document UUID.
- `publicId`: stable public URL identifier.
- `title`: server-derived title from the Markdown body.
- `body`: full Markdown body.
- `shareToken`: optional legacy public share token.
- `sharedAt`: optional share creation timestamp.
- `passwordProtected`: true when the share link requires a password.
- `createdAt`: creation timestamp.
- `updatedAt`: last update timestamp.
- `archivedAt`: omitted on active document responses.

New clients should use `publicId` when building public document URLs.

Legacy `shareToken` values may still appear for older shared documents.

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
      "publicId": "abcdefghijklmnopqrstuv",
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
  "publicId": "abcdefghijklmnopqrstuv",
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
  "publicId": "abcdefghijklmnopqrstuv",
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
  "publicId": "abcdefghijklmnopqrstuv",
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

Archives an owned active private document.

Shared documents cannot be archived.

Unshare the document before archiving it.

Archived documents are hidden from list, read, update, share, and public lookup.

Response:

```http
HTTP/1.1 204 No Content
```

Shared documents return `409`.

Malformed UUIDs, archived documents, missing documents, and documents owned by another user all return `404`.

## Share Document

```http
POST /api/v1/docs/{id}/share
```

Creates or reuses public share URLs for an owned active document.

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "token": "abcdefghijklmnopqrstuv",
  "publicId": "abcdefghijklmnopqrstuv",
  "htmlPath": "/d/abcdefghijklmnopqrstuv",
  "markdownPath": "/d/abcdefghijklmnopqrstuv.md",
  "passwordProtected": false
}
```

The paths are relative to the same origin.

CLI clients may turn them into absolute URLs by joining them with the configured API base origin.

New clients should use `publicId`, `htmlPath`, and `markdownPath`.

The `token` field is kept for backwards compatibility.

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

Unshare also clears any share password, so re-sharing never inherits stale protection.

Malformed UUIDs, archived documents, missing documents, and documents owned by another user all return `404`.

## Set Share Password

```http
PUT /api/v1/docs/{id}/share/password
Content-Type: application/json
```

```json
{ "password": "a good password" }
```

Requires a password of at least 6 characters on a document that is already shared.

The password is stored as a bcrypt hash and is never returned by the API.

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "token": "abcdefghijklmnopqrstuv",
  "publicId": "abcdefghijklmnopqrstuv",
  "htmlPath": "/d/abcdefghijklmnopqrstuv",
  "markdownPath": "/d/abcdefghijklmnopqrstuv.md",
  "passwordProtected": true
}
```

A document that is not shared returns `409`.

A password shorter than 6 characters returns `400`.

## Remove Share Password

```http
DELETE /api/v1/docs/{id}/share/password
```

Removes protection and leaves the document shared.

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

Changing or removing the password invalidates every unlock cookie already issued for that document.

## Sharing a Protected Link

A protected document has two useful links:

```
https://passage.md/d/abcdefghijklmnopqrstuv
https://passage.md/d/abcdefghijklmnopqrstuv#k=a%20good%20password
```

The first is safe to leak.
A crawler or a forwarded email reaches the unlock prompt, never the body.

The second unlocks itself.
The `#k=` fragment is read by the unlock page and posted to the unlock endpoint.
Browsers never put a fragment in the request line, so the password stays out of server logs, proxy logs, and `Referer` headers.

Treat the second link as a "share deliberately" link.
Anyone holding it has access.

## Unlock a Protected Document

```http
POST /d/{publicId}/unlock
Content-Type: application/json
```

```json
{ "password": "a good password" }
```

Response:

```http
HTTP/1.1 200 OK
Set-Cookie: passage_unlock_abcdefghijklmnopqrstuv=...; Path=/d/; HttpOnly; SameSite=Lax
```

```json
{ "unlocked": true }
```

The cookie is signed, scoped to that one document, and expires after 12 hours.

A form post of `application/x-www-form-urlencoded` returns `303` to the document instead, so the unlock page works without JavaScript.

A wrong password returns `401`.

Unlock attempts are rate limited per document and per client IP.
Exceeding the limit returns `429` with a `Retry-After` header.

## Public HTML

```http
GET /d/{publicId}
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

Missing, malformed, revoked, or archived public IDs return `404`.

A password-protected document returns `401` with the unlock page.
The unlock page contains neither the document body nor its title.

Legacy share token URLs are still accepted while older shares exist.

The HTML route is for humans.

Agents should prefer the raw Markdown route.

## Public Raw Markdown

```http
GET /d/{publicId}.md
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

Missing, malformed, revoked, or archived public IDs return `404`.

A password-protected document returns `401` until the client holds a valid unlock cookie.

Legacy share token URLs are still accepted while older shares exist.

## Status Summary

- `200`: successful read, update, or share.
- `201`: document created.
- `204`: document archived or unshared.
- `400`: invalid JSON.
- `401`: authentication required, or a protected share is still locked.
- `403`: cross-origin mutation blocked.
- `404`: document or public share not found.
- `409`: share password set on a document that is not shared.
- `415`: create or update request was not JSON.
- `429`: too many unlock attempts.
- `500`: unexpected server failure.
- `503`: database-backed service is not configured.

## MVP Deferrals

Pagination is deferred.

API token UI is defined in a separate issue.

Search is deferred.

Version history is deferred.

Document append is a CLI operation built from read plus update.
