# Technical spec: reject NUL in document bodies

Issue: #336

## Change

`validateDocumentBody` in `server/internal/documents/handler.go` is the single check used by `Create` and `Update` before the store is called.
Add a NUL check there, after the existing size check:

```go
if strings.ContainsRune(body, '\x00') {
	writeError(w, http.StatusBadRequest, "document body must not contain NUL characters")
	return false
}
```

The size check stays first, so oversized bodies still return `413`.
Search already uses the same `strings.ContainsRune` check, so this matches existing style.

Update `docs/document-api.md` to list the new `400` case.

## Tests

In `server/internal/documents/handler_test.go`:

- Create with `{"body":"a\u0000b"}` returns `400` with the message, and the fake store records no body (R1, R3).
- Update with the same body returns `400` with the message, and the fake store records no update (R2, R3).
- Existing tests cover R4: normal create and update, and the `413` oversized test.
