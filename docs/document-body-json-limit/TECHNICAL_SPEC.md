# Document body JSON limit: technical spec

## Change

In `server/internal/documents/handler.go`, set:

```go
maxDocumentRequestBytes = MaxDocumentBodyBytes*6 + 4096
```

This matches `maxTemplateRequestBytes` in `server/internal/templates/handler.go`.

## Why 6x

The worst JSON expansion for one byte is `\u00XX`, which is 6 bytes.
Go's `encoding/json` uses that form for control characters and for `<`, `>`, and `&`.
Multi-byte UTF-8 characters never grow by more than that per byte.
So any body of `MaxDocumentBodyBytes` fits in `MaxDocumentBodyBytes*6` bytes of JSON string, and 4096 bytes covers the other fields.

The decoded body check in `validateDocumentBody` is unchanged, so R3 holds.
The raw request limit still bounds memory use at about 3 MB per request.

## Tests

In `server/internal/documents/handler_test.go`, next to `TestHandlerRejectsOversizedDocumentBodies`:

- `TestHandlerAcceptsDocumentBodiesWithLargeJSONEncoding` covers R1 and R2.
  It sends the issue's reproduction body and a worst-case body of `MaxDocumentBodyBytes` bytes of `<` on create and update, and expects 201 and 200.
- The existing `TestHandlerRejectsOversizedDocumentBodies` covers R3.
- The existing `TestHandlerRejectsOversizedDocumentRequests` still covers the raw request limit.
