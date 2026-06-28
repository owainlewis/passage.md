ALTER TABLE documents
  ADD COLUMN share_token text,
  ADD COLUMN shared_at timestamptz;

CREATE UNIQUE INDEX documents_share_token_idx
  ON documents (share_token)
  WHERE share_token IS NOT NULL;
