# Document API Contract

This is the stable HTTP contract for Passage document clients.

The CLI and agent clients should build against this document instead of server handlers.

Agents should usually connect through the [MCP server](mcp.md) instead, which wraps these routes.

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

## Retired Collections

Collections were removed.
Every document belongs to one owner-wide list.

Older clients may still call the collection routes:

- `GET /api/v1/collections` returns `{"collections":[]}`.
- `POST /api/v1/collections`, `PATCH /api/v1/collections/{slug}` and `DELETE /api/v1/collections/{slug}` return `410 Gone`.
- A `collectionId` sent on `PATCH /api/v1/docs/{id}` is ignored. A request that sends only `collectionId` returns the document unchanged.
- The `collectionId` and `unfiled` search parameters are ignored.

## Document Object

Document objects use this shape:

```json
{
  "id": "11111111-1111-1111-1111-111111111111",
  "publicId": "abcdefghijklmnopqrstuv",
  "title": "Example",
  "body": "# Example\n\nMarkdown body.",
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
- `starred`: private owner star state.
- `parentId`: optional. Set on a derived doc to the `id` of the document it sits under. Omitted on top-level documents.
- `shareToken`: optional legacy public share token.
- `sharedAt`: optional share creation timestamp.
- `createdAt`: creation timestamp.
- `updatedAt`: last update timestamp.
- `archivedAt`: omitted on active document responses.

New clients should use `publicId` when building public document URLs.

Legacy `shareToken` values may still appear for older shared documents.

The star field appears only on authenticated document API responses.

They do not appear in public HTML, raw Markdown, or exported Markdown bodies.

`title` is derived from the first non-empty Markdown line.

If no title can be derived, the title is `Untitled`.

## Derived Docs

A document can hold derived docs: child documents nested one level under it.
A writer keeps a source piece as the parent, and the newsletter, post, or script made from it as its children.

- `parentId` is the whole relationship. A child holds no other link back to its parent.
- Nesting is one level deep. A derived doc cannot have derived docs of its own.
- `parentId` is set when the document is created and never changes. `PATCH` ignores it.
- The parent must be an active document owned by the same user.
- Derived docs count toward the saved document limit like any other document.
- Derived docs are available on every plan.
- A derived doc is read, updated, shared, and archived through the same routes as any document.
- Archiving a parent archives its derived docs with it.

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
      "starred": false,
      "createdAt": "2026-06-28T12:00:00Z",
      "updatedAt": "2026-06-28T12:00:00Z"
    }
  ]
}
```

This request remains the legacy compatibility form.

It returns every active document, including each complete `body`, so released CLI clients continue to work.

The legacy form is flat.
Derived docs appear in the same list as their parents, each with `parentId` set.

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

Paginated responses return top-level documents only.

They are ordered by the top-level document's own `updatedAt` descending, with document ID as a stable tie-breaker.

Editing a derived doc does not move its parent in the list.

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
      "starred": false,
      "createdAt": "2026-06-28T12:00:00Z",
      "updatedAt": "2026-06-28T12:00:00Z",
      "children": [
        {
          "id": "33333333-3333-3333-3333-333333333333",
          "publicId": "zyxwvutsrqponmlkjihgfe",
          "title": "Newsletter",
          "excerpt": "# Newsletter\n\nThe beginning of the derived doc.",
          "tags": [],
          "starred": false,
          "parentId": "11111111-1111-1111-1111-111111111111",
          "createdAt": "2026-06-28T12:10:00Z",
          "updatedAt": "2026-06-28T12:10:00Z"
        }
      ]
    }
  ],
  "nextCursor": "opaque-value"
}
```

`children` holds the metadata of the document's derived docs, ordered by `createdAt` ascending.

It is omitted when the document has none.

A derived doc is never returned as a row of its own, and never counts toward `limit`, so a page boundary cannot separate it from its parent.

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
GET /api/v1/docs/search?q=agent+workflow&limit=50&cursor=<opaque-cursor>
```

Returns ranked metadata for active documents owned by the authenticated user.

Search covers the server-derived title and complete current Markdown body, including frontmatter stored in the body.

It does not search archived documents, anonymous content, public documents owned by another account, or historical document versions.

Parameters:

- `q` is required. After surrounding whitespace is removed and internal whitespace is collapsed, it must contain 1 through 200 Unicode characters and at least one term recognized by PostgreSQL.
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

Derived docs are searched and returned like any other document, with `parentId` set.

Search is limited per authenticated user and returns `429` with `Retry-After` when the limit is exceeded.

`nextCursor` is omitted on the final page.

The cursor is bound to the normalized query that created it.

Clients must send the cursor back unchanged with the same `q`.

Invalid limits, cursors, overlong queries, and queries with no searchable terms return `400`.

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
  "starred": false,
  "createdAt": "2026-06-28T12:00:00Z",
  "updatedAt": "2026-06-28T12:00:00Z"
}
```

Request rules:

- If `body` is omitted, the server treats it as an empty string.
- Empty `body` is accepted and creates an `Untitled` document.
- `parentId` is optional. When present, the new document is created as a derived doc of that document.

Creating a derived doc:

```json
{"body":"# Newsletter\n\nMarkdown body.","parentId":"11111111-1111-1111-1111-111111111111"}
```

The response is the new document with `parentId` set.

A `parentId` that is malformed, missing, archived, or owned by another user returns `404`.

A `parentId` that names a derived doc returns `400`, because nesting is one level deep.

A derived doc created at the saved document limit is refused like any other create.

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

`PATCH` accepts any non-empty combination of `body` and `starred`.

`body` replaces the full Markdown body when present.

Omitting `body` leaves the Markdown body unchanged, so metadata-only updates are supported:

```json
{"starred":true}
```

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

Archiving a document that has derived docs archives all of them in the same transaction.

Only the document named in the request must be unshared first.
A shared derived doc is archived with its parent, and its public URLs then return `404`.

Archiving a derived doc leaves its parent and the parent's other derived docs unchanged.

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
- `400`: invalid JSON, or a derived doc created under another derived doc.
- `401`: authentication required.
- `402`: a bearer-token document request requires Pro.
- `429`: an abuse limit was exceeded.
- `403`: cross-origin mutation blocked.
- `404`: document, parent document, or public share not found.
- `415`: create or update request was not JSON.
- `500`: unexpected server failure.
- `503`: database-backed service is not configured.

## MVP Deferrals

API token UI is defined in a separate issue.

Version history is deferred.

Document append is a CLI operation built from read plus update.
