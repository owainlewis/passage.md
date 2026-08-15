ALTER TABLE documents
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple'::regconfig, title), 'A') ||
    setweight(to_tsvector('simple'::regconfig, body), 'B')
  ) STORED;

CREATE INDEX documents_active_search_idx
  ON documents USING gin (search_vector)
  WHERE archived_at IS NULL;
