-- Attribution for document content changes.
--
-- People and agents write to the same documents. A bearer request already
-- carries a named API token, but that name was discarded once the request was
-- resolved to an owning user, so a browser edit and an agent edit were
-- indistinguishable after the fact.
--
-- actor_key is the identity a contribution is grouped by: an API token id, or
-- the literal 'owner' for the account holder writing in a browser. A plain
-- nullable token id cannot carry the primary key, because Postgres treats
-- NULLs as distinct and every owner autosave would insert another row.
--
-- actor_name snapshots the token name at contribution time so historical
-- attribution survives a rename or a revocation.
--
-- Additive and safe while the previous application version is still serving:
-- existing documents simply have no attribution until their next content write.
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS last_editor_key text,
  ADD COLUMN IF NOT EXISTS last_editor_name text,
  ADD COLUMN IF NOT EXISTS last_edited_at timestamptz;

CREATE TABLE IF NOT EXISTS document_contributors (
  document_id uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  actor_key text NOT NULL,
  actor_name text,
  first_contributed_at timestamptz NOT NULL DEFAULT now(),
  last_contributed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, actor_key)
);

-- Contributors are always read for one document, most recent first.
CREATE INDEX IF NOT EXISTS document_contributors_recent_idx
  ON document_contributors (document_id, last_contributed_at DESC);
