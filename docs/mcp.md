# Passage MCP Server

Passage serves the [Model Context Protocol](https://modelcontextprotocol.io) at `/mcp`.

Agents such as Claude Code, Cursor and Codex use it to search, read and edit the same private Markdown the owner writes in the browser.

MCP is the recommended way to connect an agent. The [document API](document-api.md) remains for scripts and custom clients.

## Requirements

- Passage Pro. Free accounts get `402 Payment Required`.
- An API token, created on the account page. Name it after the agent, because every edit the agent makes is attributed to the token name.

## Connect Claude Code

```sh
claude mcp add --transport http passage https://passage.md/mcp --header "Authorization: Bearer psg_..."
```

The account page shows this command with the new token filled in right after a token is created.

Check it with `claude mcp list`, then ask Claude something like "find my notes on pricing".

## Connect other clients

Clients that support remote MCP servers over HTTP take the URL and an `Authorization` header:

```json
{
  "mcpServers": {
    "passage": {
      "type": "http",
      "url": "https://passage.md/mcp",
      "headers": { "Authorization": "Bearer psg_..." }
    }
  }
}
```

For local development, use `http://localhost:3000/mcp`.

## Tools

| Tool | Input | Does |
| --- | --- | --- |
| `search_documents` | `query`, optional `limit` (1 to 50) | Ranked full-text search. Title matches first. Returns ids, titles and a short excerpt. |
| `list_documents` | optional `cursor`, `limit` (1 to 100) | Documents by most recent update, without bodies. Each document is followed by its derived docs. Pass `nextCursor` back for the next page. |
| `read_document` | `id` | The full Markdown body. |
| `create_document` | `markdown`, optional `parentId` | A new private document. The first line becomes the title. With `parentId`, it is saved as a derived doc under that document. |
| `edit_document` | `id`, `oldText`, `newText` | Replaces one exact passage. Fails if `oldText` is missing or appears more than once. |
| `append_to_document` | `id`, `markdown` | Adds Markdown to the end, after a blank line. |

Results that point at a document include a `url` that opens it in the writer.

Errors come back as tool errors with a plain message the agent can act on, such as "oldText appears 2 times; include more surrounding text so it matches once".

## Derived docs

A document can hold derived docs: pieces made from it, such as a newsletter, a post, or a script.

To save one, pass the source document's `id` as `parentId` to `create_document`.

Nesting is one level deep, so the parent must be a top-level document.

A derived doc carries `parentId` in list, search, read, and write results.

In `list_documents`, derived docs follow their parent and do not count toward `limit`.

A prompt such as "turn my launch post into a newsletter and a LinkedIn post, and save them under it" is enough.

## Behavior

Edits and appends are applied to the latest stored body and written with the document version guard.

If the owner's autosave lands between the read and the write, the server rebuilds the change on the new text and tries again, up to three times.

An agent therefore never overwrites a sentence the owner just typed.

There are no share, unshare or delete tools. Publishing and archiving stay with the owner in the browser.

## Auth and limits

`/mcp` accepts only `Authorization: Bearer` API tokens. Browser session cookies are ignored, so a web page cannot drive the tools.

Missing or revoked tokens get `401` with a `WWW-Authenticate: Bearer` header.

Tool calls share the document API's per-user limits: searches count against the search limit, and creates, edits and appends count against the mutation limit. Reads are not limited.

The saved document limit applies to `create_document`.

## Transport

The endpoint uses stateless Streamable HTTP with JSON responses. Each request stands alone, so there are no MCP sessions to keep or expire.
