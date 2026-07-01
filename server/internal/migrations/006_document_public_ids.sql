ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS public_id text;

UPDATE documents
SET public_id = replace(gen_random_uuid()::text, '-', '')
WHERE public_id IS NULL;

ALTER TABLE documents
  ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS documents_public_id_idx
  ON documents (public_id);
