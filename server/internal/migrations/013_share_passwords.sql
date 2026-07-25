ALTER TABLE documents
  ADD COLUMN share_password_hash text;

CREATE TABLE document_unlock_rate_limits (
  dimension text NOT NULL CHECK (dimension IN ('ip', 'document')),
  key_hash text NOT NULL,
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  PRIMARY KEY (dimension, key_hash)
);

CREATE INDEX document_unlock_rate_limits_window_idx
ON document_unlock_rate_limits (window_started_at);
