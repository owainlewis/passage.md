# Document version range: product spec

Issue: #337

## Problem

`PATCH /api/v1/docs/{id}` accepts an optional `version` for conditional writes.
A version above the int32 range returns 500 because the database driver cannot encode it.
A version below 1 returns 409 with the full document, although no document can have that version.

## Requirements

- R1: A `version` below 1 returns 400 "invalid version".
- R2: A `version` above `math.MaxInt32` returns 400 "invalid version".
- R3: The store is not called for R1 or R2 requests.
- R4: An omitted `version` keeps today's behavior and reaches the store as an unconditional write.
- R5: A valid `version` (1 through `math.MaxInt32`) keeps today's 200 or 409 behavior.

## Out of scope

- Changing how version conflicts work.
