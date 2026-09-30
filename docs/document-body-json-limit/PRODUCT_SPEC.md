# Document body JSON limit

Issue: #335

## Problem

The documents API rejects some legal documents with 413 "request body is too large".
The body limit is 512 KB of Markdown, but the raw request limit is only 4 KB larger.
JSON escaping of newlines, quotes, and control characters can make the request several times larger than the body.

## Requirements

- R1: Create accepts a body of up to `MaxDocumentBodyBytes` bytes, even when its JSON encoding is several times larger.
- R2: Update accepts a body of up to `MaxDocumentBodyBytes` bytes, even when its JSON encoding is several times larger.
- R3: A body over `MaxDocumentBodyBytes` still returns 413 "document body is too large" on create and update.

## Out of scope

- Changing `MaxDocumentBodyBytes`.
- Template and collection limits.
