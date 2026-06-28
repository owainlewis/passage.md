# passage.md — task runner
# Usage: `just <recipe>`. Run `just` to list recipes.

# Default: list available recipes
default:
    @just --list

# Run database migrations
migrate:
    go run ./server/cmd/passage migrate

# Start the full local app with the Go server and Postgres
dev:
    npm run dev

# Start the frontend-only Next dev server
dev-web:
    npm run dev:web
