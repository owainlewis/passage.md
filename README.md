# passage.md

A hosted Markdown workspace for humans and agents.

`passage.md` is a calm browser place to write Markdown, save it online, share it by URL, and let agents work with the same documents through raw Markdown, CLI, and API workflows.

It is not trying to be a local Markdown editor, a personal knowledge base, or a heavy team workspace.

The problem is file wrangling.

Local Markdown files are fine until the document needs to move between your laptop, your phone, another person, and an agent.

Anonymous users can write transient docs in the browser.

Free accounts can save 5 hosted docs and use the CLI with those docs.

Pro users can save 1,000 hosted docs, sync, export, share, use custom themes, and use higher-limit CLI/API workflows.

## Product

The product reference is Google Docs, Notion, and GitHub Gist, but stripped down to plain Markdown.

Google Docs is too rich for Markdown.

Notion is too heavy for a simple document.

GitHub Gists are useful, but they are developer plumbing, not a calm writing surface.

Passage is browser-first, URL-native Markdown.

The visual reference is calm minimalism without becoming a local-file writing app.

The technical wedge is agent usefulness without copy-paste, sync folders, or repo setup.

Every saved doc is plain Markdown, private by default, and addressable through web, CLI, and API.

## Docs

- [PRD](docs/prd.md)
- [Architecture](docs/architecture.md)
- [Production runbook](docs/production-runbook.md)
- [Document API contract](docs/document-api.md)
- [CLI](docs/cli.md)
- [Project board](https://github.com/users/owainlewis/projects/14)
- [Goal prompts](docs/goal-prompts.md)

GitHub Issues and project board 14 are the source of truth for roadmap, phase order, issue scope, acceptance criteria, dependencies, verification, and status.

Local docs are product and architecture notes only.

If local docs conflict with a GitHub issue, the GitHub issue wins.

## Local Development

Prerequisites:

- Node.js 22 or newer.
- npm 10 or newer.
- Go 1.26 or newer.
- A native local PostgreSQL install, such as Postgres.app or Homebrew Postgres.

Install dependencies:

```sh
npm install
```

Create a local database:

```sh
createdb passage_dev
export DATABASE_URL='postgres://localhost:5432/passage_dev?sslmode=disable'
```

`npm run dev` uses that local database URL by default.

Run database migrations:

```sh
go run ./server/cmd/passage migrate
```

`passage serve` never applies migrations.
Run `migrate` before starting the app locally or deploying a new application revision.
`npm run dev` does this automatically.

Build the static web app and run the Go server:

```sh
export SESSION_SECRET='dev-session-secret-change-me'
npm run dev
```

The Go server runs at `http://localhost:3000` by default and serves `/api/health`.

`DATABASE_URL` is required for `serve`; the dev command defaults it to `postgres://localhost:5432/passage_dev?sslmode=disable`.
`PASSAGE_DATABASE_MAX_CONNS` sets the per-process Postgres pool limit and defaults to `3`.

`SESSION_SECRET` must be set explicitly when `APP_ENV=production`.

Copy `.env.example` to `.env` for local environment values.

Password reset links are logged by the Go server in local development when Resend is not configured.
To send real local email, set both `RESEND_API_KEY` and `RESEND_FROM` in `.env`.

Stripe billing is off by default.
Set `STRIPE_BILLING_ENABLED=true` only after `STRIPE_SECRET_KEY`, `STRIPE_MONTHLY_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, and `APP_BASE_URL` are configured.

### Abuse rate limits

The Go server applies fixed-window limits before handling auth mutations, authenticated document mutations, API-token requests, shared HTML, and raw Markdown.
Defaults are 20 auth mutations, 120 document mutations, 30 API-token requests, 120 shared HTML requests, and 240 raw Markdown requests per minute.
Authenticated limits are keyed by user ID.
Public and auth limits are keyed by client IP.
Each class can be changed with the matching `PASSAGE_RATE_LIMIT_<CLASS>_REQUESTS` and `PASSAGE_RATE_LIMIT_<CLASS>_WINDOW` environment values shown in `.env.example`.
Set a request count to `0` to disable that class.

Production trusts `X-Forwarded-For` only when the immediate peer is in the configured `PASSAGE_TRUSTED_PROXY_CIDRS`.
It selects the client using `PASSAGE_FORWARDED_HOPS`, which defaults to the two proxy hops in the Cloud Run ingress path.
Local development trusts no forwarding headers.
Override both values together if the production proxy path changes.

With Postgres configured and writes enabled, counters are enforced atomically across Cloud Run instances and survive deploys and instance restarts.
Client IPs and user IDs are stored only as scoped HMAC digests.
Expired counters are removed through bounded, indexed cleanup batches.
Local development without Postgres uses process-local counters.
Database recovery mode also uses process-local counters so allowed reads remain database read-only while the outer write fence blocks mutations.
The existing Postgres-backed password-reset request and confirmation limits remain separate and unchanged.

### Production password reset email

Passage sends password reset email through Resend from `passage.md <mail@passage.md>`.

Add `passage.md` as a sending domain in Resend.
Create the DNS records Resend supplies, then wait for Resend to show the domain as verified.
The exact DNS values come from Resend and must not be copied from another domain.

The deployment workflow expects the API key in Google Secret Manager as `passage-resend-api-key`.
Create the secret once, then add the key over standard input so it does not appear in shell history:

```sh
gcloud secrets create passage-resend-api-key --replication-policy=automatic
gcloud secrets versions add passage-resend-api-key --data-file=-
gcloud secrets add-iam-policy-binding passage-resend-api-key \
  --member='serviceAccount:passage-md-build@passage-md-prod.iam.gserviceaccount.com' \
  --role='roles/secretmanager.secretAccessor'
gcloud secrets add-iam-policy-binding passage-resend-api-key \
  --member='serviceAccount:passage-md-run@passage-md-prod.iam.gserviceaccount.com' \
  --role='roles/secretmanager.secretAccessor'
```

The production deployment sets `APP_BASE_URL=https://passage.md`, binds the secret as `RESEND_API_KEY`, and sets `RESEND_FROM` to the verified sender.
It also keeps one Cloud Run instance running with CPU available so queued reset email is delivered without waiting for another web request.
Do not commit or paste the API key into GitHub, logs, or screenshots.

For frontend-only UI iteration, `npm run dev:web` starts Next.js at `http://localhost:3001`.

That mode is not the local acceptance path because it does not run the Go API or Postgres.

Run lint:

```sh
npm run lint
```

Run tests:

```sh
npm test
go test ./server/...
```

Audit production dependencies:

```sh
npm audit --omit=dev --audit-level=high
```

CI fails on high or critical production advisories.
The root overrides are temporary, exact pins for dependencies that the current Next.js patch still resolves to vulnerable versions.
They replace only Next.js's exact vulnerable PostCSS and sharp resolutions.
The full audit still reports brace-expansion and its ESLint dependants as high severity.
Those paths are development-only, do not ship in the application image, and cannot take untrusted runtime input.
Clearing them requires incompatible minimatch or ESLint upgrades, so revisit them when the project adopts ESLint 10 instead of forcing development dependencies across major-version boundaries.
Remove an override after its direct parent declares a fixed compatible dependency and `npm audit` remains clear.

Build the web app:

```sh
npm run build:web
```

Build the production container:

```sh
docker build -t passage-md .
```

## Repository Status

The implementation plan lives on the [GitHub project board](https://github.com/users/owainlewis/projects/14), which is the source of truth for issues.
