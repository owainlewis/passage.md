# Passage CLI

The Passage CLI lets humans and agents work with hosted Markdown from a terminal.

The public repo is `owainlewis/passage-cli`.

Releases live at <https://github.com/owainlewis/passage-cli/releases>.

## Install

Download a release archive for your platform when a tagged release exists.

Until then, build locally:

```sh
git clone https://github.com/owainlewis/passage-cli
cd passage-cli
go test ./...
go build ./cmd/passage
./passage version
```

## API Tokens

Sign in to Passage in the browser.

Open the account menu in the editor.

Create an API token with a clear name, then copy the plaintext token immediately.

Passage only shows the plaintext token once.

Run:

```sh
passage login
passage auth status --check
```

Revoke unused tokens from the same account menu.

After revoke, the old token returns `401` on private document API routes.

## Commands

```sh
passage new "Draft"
passage list
passage cat <doc-id>
passage pull <doc-id>
passage push <doc-id> ./draft.md
passage append <doc-id> ./notes.md
passage replace <doc-id> ./draft.md
passage list --json
```

Use JSON output when scripts or agents need stable structured data.

## Raw Markdown

Private documents are available through the authenticated CLI and document API.

Public shared documents expose read-only `.md` URLs for agents that need direct Markdown context.

Sharing returns both an HTML page path and a raw Markdown path.

The raw path uses this shape:

```text
/d/<share-token>.md
```

Only share a document when that raw URL should be public to anyone who has the link.

Unshare the document to revoke both the HTML URL and raw Markdown URL.
