# Plan

Updated: 2026-06-27

We are working on Phase 1.

GitHub Issues and project 14 are the execution tracker.

This file is only repo memory.

## Phase 1: Local App

- [ ] [#33 Scaffold the Go server](https://github.com/owainlewis/passage.md/issues/33)
- [ ] [#26 Email/password accounts and sessions](https://github.com/owainlewis/passage.md/issues/26)
- [ ] [#27 Persist documents per user in Postgres](https://github.com/owainlewis/passage.md/issues/27)
- [ ] [#28 Server-backed share links and raw .md URLs](https://github.com/owainlewis/passage.md/issues/28)

## Phase 2: GCP Deploy

- [ ] [#25 Deploy to Google Cloud](https://github.com/owainlewis/passage.md/issues/25)
- [ ] [#35 Configure DNS for Cloud Run](https://github.com/owainlewis/passage.md/issues/35)

## Phase 3: Email Auth

- [ ] [#39 Add password reset emails](https://github.com/owainlewis/passage.md/issues/39)
- [ ] [#40 Add magic-link sign-in](https://github.com/owainlewis/passage.md/issues/40)

## Phase 4: Pro Accounts

- [ ] [#29 Add Stripe billing and paid entitlements](https://github.com/owainlewis/passage.md/issues/29)
- [ ] [#34 Admin and config surface for feature flags and user limits](https://github.com/owainlewis/passage.md/issues/34)
- [ ] [#36 Enforce and reflect free/Pro limits](https://github.com/owainlewis/passage.md/issues/36)

## Phase 5: Agent-Native CLI/API

- [ ] [#31 Document API with API-token auth](https://github.com/owainlewis/passage.md/issues/31)

## Decisions

- Phase 1 uses email/password auth only.
- Phase 1 skips outbound email.
- Password resets and magic links are Phase 3.
- Stripe and Pro limits are Phase 4.
- CLI/API is Phase 5.

## Needs Cleanup

- None.
