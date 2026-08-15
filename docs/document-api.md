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

## Collection Object

Collections are private, owner-scoped document groups.

The built-in `Documents` view represents documents whose `collectionId` is `null`.

It is not a stored collection and does not appear in collection API responses.

Collection objects use this shape:

```json
{
  "id": "22222222-2222-2222-2222-222222222222",
  "slug": "research",
  "title": "Research",
  "description": "Sources, findings, and notes worth returning to.",
  "createdAt": "2026-06-28T12:00:00Z",
  "updatedAt": "2026-06-28T12:00:00Z"
}
```

Each account starts with `Operating Context`, `Content Studio`, `Passage`, and `Research` once.

Collection slugs are created by the server and never change when a collection is renamed.

An account can have at most 100 collections.

Titles must contain 1 to 80 characters after trimming.

Descriptions are optional and can contain at most 180 characters.

### List Collections

```http
GET /api/v1/collections
```

Returns `{"collections":[...]}` for the authenticated owner.

### Create Collection

```http
POST /api/v1/collections
Content-Type: application/json
```

```json
{"title":"Customer research","description":"Interview notes and findings."}
```

Returns the collection with `201 Created`.

The server derives a unique, stable slug from the title.

The 101st collection returns `409`.

### Update Collection

```http
PATCH /api/v1/collections/{slug}
Content-Type: application/json
```

```json
{"title":"Product research","description":null}
```

The title and description can change.

The slug cannot change.

Missing collections and collections owned by another account return `404`.

### Delete Collection

```http
DELETE /api/v1/collections/{slug}
```

Returns `204 No Content`.

Deletion atomically moves the collection's documents into the built-in `Documents` view.

It does not change Markdown bodies, stars, public links, or raw Markdown responses.

## Document Object

Document objects use this shape:

```json
{
  "id": "11111111-1111-1111-1111-111111111111",
  "publicId": "abcdefghijklmnopqrstuv",
  "title": "Example",
  "body": "# Example\n\nMarkdown body.",
  "collectionId": "22222222-2222-2222-2222-222222222222",
  "collectionSlug": "research",
  "starred": true,
  "sharedAt": "2026-06-28T12:00:00Z",
  "createdAt": "2026-06-28T12:00:00Z",
  "updatedAt": "2026-06-28T12:00:00Z"
}
```

Fields:

- `id`: document UUID.
- `publicId`: stable public URL identifier.
- `title`: server-derived title from the Markdown body.
- `body`: full Markdown body.
- `collectionId`: private collection UUID, or `null` for the built-in `Documents` view.
- `collectionSlug`: stable private collection slug, or `null` for the built-in `Documents` view.
- `starred`: private owner star state.
- `shareToken`: optional legacy public share token.
- `sharedAt`: optional share creation timestamp.
- `createdAt`: creation timestamp.
- `updatedAt`: last update timestamp.
- `archivedAt`: omitted on active document responses.

New clients should use `publicId` when building public document URLs.

Legacy `shareToken` values may still appear for older shared documents.

Collection and star fields appear only on authenticated document API responses.

They do not appear in public HTML, raw Markdown, or exported Markdown bodies.

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
      "collectionId": null,
      "collectionSlug": null,
      "starred": false,
      "createdAt": "2026-06-28T12:00:00Z",
      "updatedAt": "2026-06-28T12:00:00Z"
    }
  ]
}
```

This request remains the legacy compatibility form.

It returns every active document, including each complete `body`, so released CLI clients continue to work.

New browser and API clients should use the bounded metadata form below.

### Paginated document metadata

```http
GET /api/v1/docs?limit=50
GET /api/v1/docs?limit=50&cursor=<opaque-cursor>
```

`limit` must be an integer from `1` to `100`.

If a `cursor` is supplied without a limit, the server uses `50`.

The cursor is opaque.

Clients must send it back unchanged and must not build or inspect cursor values.

Paginated responses are ordered by `updatedAt` descending, with document ID as a stable tie-breaker.

They include metadata and a bounded excerpt, but never the complete Markdown body:

```json
{
  "documents": [
    {
      "id": "11111111-1111-1111-1111-111111111111",
      "publicId": "abcdefghijklmnopqrstuv",
      "title": "Example",
      "excerpt": "# Example\n\nThe beginning of the document.",
      "tags": ["agents", "notes"],
      "collectionId": null,
      "collectionSlug": null,
      "starred": false,
      "createdAt": "2026-06-28T12:00:00Z",
      "updatedAt": "2026-06-28T12:00:00Z"
    }
  ],
  "nextCursor": "opaque-value"
}
```

`excerpt` contains at most the first 4,096 characters and exists only to support bounded navigation and previews.

`tags` contains valid Passage tags parsed from frontmatter in that excerpt.

`nextCursor` is omitted on the final page.

An empty library returns `{"documents":[]}`.

Invalid limits and cursors return `400`.

Opening a metadata result requires `GET /api/v1/docs/{id}` to load the complete body.

All list forms enforce the authenticated owner, so cursors never grant access to another account's documents.

## Search Documents

```http
GET /api/v1/docs/search?q=agent+workflow
GET /api/v1/docs/search?q=agent+workflow&collectionId=22222222-2222-2222-2222-222222222222&limit=50&cursor=<opaque-cursor>
GET /api/v1/docs/search?q=agent+workflow&unfiled=true
```

Returns ranked metadata for active documents owned by the authenticated user.

Search covers the server-derived title and complete current Markdown body, including frontmatter stored in the body.

It does not search archived documents, templates, anonymous content, public documents owned by another account, or historical document versions.

Parameters:

- `q` is required. After surrounding whitespace is removed and internal whitespace is collapsed, it must contain 1 through 200 Unicode characters and at least one term recognized by PostgreSQL.
- `collectionId` is optional. It restricts results to one collection owned by the authenticated user.
- `unfiled=true` is optional. It restricts results to documents in the built-in `Documents` view, where `collectionId` is `null`.
- `collectionId` and `unfiled` are mutually exclusive.
- `limit` is optional and defaults to `50`. Valid values are `1` through `100`.
- `cursor` is optional and opaque.

Queries use PostgreSQL web-style parsing with the `simple` text-search configuration.

Ordinary terms, quoted phrases, and exclusions such as `agent -retired` are supported.

The `simple` configuration does not apply language stemming, so names, code terms, and product identifiers remain searchable as written.

Title matches rank above body-only matches.

Equal ranks are ordered by `updatedAt` descending and then document ID descending.

Response:

```json
{
  "documents": [
    {
      "id": "11111111-1111-1111-1111-111111111111",
      "publicId": "abcdefghijklmnopqrstuv",
      "title": "Agent workflow",
      "matchExcerpt": "Notes from the agent workflow review.",
      "tags": ["agents", "notes"],
      "collectionId": "22222222-2222-2222-2222-222222222222",
      "collectionSlug": "research",
      "starred": true,
      "createdAt": "2026-06-28T12:00:00Z",
      "updatedAt": "2026-06-28T12:00:00Z"
    }
  ],
  "nextCursor": "opaque-value"
}
```

`matchExcerpt` is untrusted plain text containing at most 240 characters around a match.

Clients must render it as text, never as HTML.

Search responses never contain the complete `body` and set `Cache-Control: private, no-store`.

Search is limited per authenticated user and returns `429` with `Retry-After` when the limit is exceeded.

`nextCursor` is omitted on the final page.

The cursor is bound to the normalized query and scope that created it.

Clients must send the cursor back unchanged with the same `q`, `collectionId`, or `unfiled` values.

Invalid limits, cursors, conflicting scopes, overlong queries, queries with no searchable terms, malformed collection IDs, and missing or cross-owner collection IDs return `400`.

All search queries are owner-scoped and exclude archived documents.

Browser sessions may search on Free or Pro accounts.

Bearer-token callers retain the existing Pro requirement for document API access.

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
  "collectionId": null,
  "collectionSlug": null,
  "starred": false,
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
  "collectionId": null,
  "collectionSlug": null,
  "starred": false,
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

`PATCH` accepts any non-empty combination of `body`, `collectionId`, and `starred`.

`body` replaces the full Markdown body when present.

Omitting `body` leaves the Markdown body unchanged, so metadata-only updates are supported:

```json
{"collectionId":"22222222-2222-2222-2222-222222222222","starred":true}
```

Send `{"collectionId":null}` to move the document into the built-in `Documents` view.

The collection must belong to the authenticated document owner.

Missing and cross-owner collection IDs return `400` without changing the document.

Existing body-only API and CLI requests remain compatible.

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
  "collectionId": null,
  "collectionSlug": null,
  "starred": false,
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
  "markdownPath": "/d/abcdefghijklmnopqrstuv.md"
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

Malformed UUIDs, archived documents, missing documents, and documents owned by another user all return `404`.

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

Legacy share token URLs are still accepted while older shares exist.

## Status Summary

- `200`: successful read, update, or share.
- `201`: document created.
- `204`: document archived or unshared.
- `400`: invalid JSON.
- `401`: authentication required.
- `402`: a bearer-token document request requires Pro.
- `429`: an abuse limit was exceeded.
- `403`: cross-origin mutation blocked.
- `404`: document or public share not found.
- `415`: create or update request was not JSON.
- `500`: unexpected server failure.
- `503`: database-backed service is not configured.

## MVP Deferrals

API token UI is defined in a separate issue.

Version history is deferred.

Document append is a CLI operation built from read plus update.
