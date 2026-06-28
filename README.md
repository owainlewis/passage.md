# passage.md

A Markdown notepad for agents and humans.

`passage.md` is a minimal Markdown writing app with a CLI-first workflow.

Anonymous users can write transient docs in the browser.

Free accounts can save 5 hosted docs and use the CLI with those docs.

Pro users can save unlimited docs with fair use, sync, export, share, customize themes, and use higher-limit CLI/API workflows.

## Product

The product reference is GitHub Gist with a better writing surface.

The visual reference is iA Writer-style minimalism.

The technical wedge is agent usefulness.

Every saved doc is plain Markdown, private by default, and addressable through web, CLI, and API.

## Docs

- [PRD](docs/prd.md)
- [Architecture](docs/architecture.md)
- [Project board](https://github.com/users/owainlewis/projects/14)
- [Goal prompts](docs/goal-prompts.md)
- [Local MVP demo goal](docs/local-mvp-demo-goal.md)

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

Run the web app:

```sh
npm run dev:web
```

The app runs at `http://localhost:3000` by default.

If that port is busy, Next.js prints the alternate local URL.

Create a local database:

```sh
createdb passage_dev
export DATABASE_URL='postgres://localhost:5432/passage_dev?sslmode=disable'
```

Run database migrations:

```sh
go run ./server/cmd/passage migrate
```

Build the static web app and run the Go server:

```sh
npm run build:web
STATIC_DIR=apps/web/out go run ./server/cmd/passage serve
```

The Go server runs at `http://localhost:8080` by default and serves `/api/health`.

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

## Phases

Phase 1 gets the server-backed local app running with auth, saved docs, sharing, and raw Markdown URLs.

Phase 2 deploys the server-backed app to GCP.

Phase 3 adds email auth flows.

Phase 4 adds payments and the public paid tier.

## Repository Status

The anonymous browser editor foundation is built.

The implementation plan lives on the [GitHub project board](https://github.com/users/owainlewis/projects/14), which is the source of truth for issues.
