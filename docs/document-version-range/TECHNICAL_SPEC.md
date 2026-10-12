# Document version range: technical spec

Issue: #337

## Change

In `server/internal/documents/handler.go`, `Handler.Update` checks `input.Version` after decoding and body validation.
If it is set and is below 1 or above `math.MaxInt32`, the handler writes 400 "invalid version" and returns before calling the store.

Versions start at 1 and are stored in a Postgres `integer` column, so this range covers every version that can exist.

No store, schema, or client changes.

## Tests

In `server/internal/documents/handler_test.go`, the fake store counts `Update` calls and can return a configured error.

- `TestHandlerRejectsOutOfRangeVersionsBeforeStore`: versions 0, -1 and 3000000000 return 400 "invalid version" with zero store calls (R1, R2, R3).
- `TestHandlerKeepsValidAndOmittedVersionBehavior`: omitted version, 1 and `math.MaxInt32` return 200 and pass the version through; a store `ErrVersionConflict` still returns 409 (R4, R5).
