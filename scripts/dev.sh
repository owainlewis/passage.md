#!/usr/bin/env sh
set -eu

DEFAULT_DATABASE_URL='postgres://localhost:5432/passage_dev?sslmode=disable'

export DATABASE_URL="${DATABASE_URL:-$DEFAULT_DATABASE_URL}"
export PORT="${PORT:-3000}"
export SESSION_SECRET="${SESSION_SECRET:-dev-session-secret-change-me}"
export STATIC_DIR="${STATIC_DIR:-apps/web/out}"

if [ "$DATABASE_URL" = "$DEFAULT_DATABASE_URL" ] && command -v createdb >/dev/null 2>&1; then
  createdb passage_dev 2>/dev/null || true
fi

npm run build:web
go run ./server/cmd/passage migrate
go run ./server/cmd/passage serve
