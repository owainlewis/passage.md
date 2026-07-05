# passage.md

A hosted Markdown workspace for humans and agents.

`passage.md` is a calm browser place to write Markdown, save it online, share it by URL, and let agents work with the same documents through raw Markdown, CLI, and API workflows.

It is not trying to be a local Markdown editor, a personal knowledge base, or a heavy team workspace.

The problem is file wrangling.

Local Markdown files are fine until the document needs to move between your laptop, your phone, another person, and an agent.

Anonymous users can write transient docs in the browser.

Free accounts can save 5 hosted docs and use the CLI with those docs.

Pro users can save unlimited docs with fair use, sync, export, share, custom themes, and higher-limit CLI/API workflows.

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
- [Document API contract](docs/document-api.md)
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

Build the static web app and run the Go server:

```sh
export SESSION_SECRET='dev-session-secret-change-me'
npm run dev
```

The Go server runs at `http://localhost:3000` by default and serves `/api/health`.

`DATABASE_URL` is required for `serve`; the dev command defaults it to `postgres://localhost:5432/passage_dev?sslmode=disable`.

`SESSION_SECRET` must be set explicitly when `APP_ENV=production`.

Stripe billing is off by default.
Set `STRIPE_BILLING_ENABLED=true` only after `STRIPE_SECRET_KEY`, `STRIPE_MONTHLY_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, and `APP_BASE_URL` are configured.

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
