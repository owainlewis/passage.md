# Reject NUL in document bodies

Issue: #336

## Problem

A document body that contains a NUL character makes create and update fail with a 500.
Postgres `text` columns cannot store NUL, so the insert fails late and the client gets an unhelpful error.

## Requirements

- R1: `POST /api/v1/docs` with a NUL in the body returns `400` with the message `document body must not contain NUL characters`.
- R2: `PATCH /api/v1/docs/{id}` with a NUL in the body returns the same `400`.
- R3: The store is not called for R1 or R2 requests.
- R4: Bodies without NUL behave exactly as before, including the existing `413` for oversized bodies.

## Out of scope

- Template and collection input.
- Other control characters.
