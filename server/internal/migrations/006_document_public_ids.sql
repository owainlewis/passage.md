ALTER TABLE documents
  ADD COLUMN public_id text;

UPDATE documents
SET public_id = translate(rtrim(encode(gen_random_bytes(16), 'base64'), '='), '+/', '-_')
WHERE public_id IS NULL;

ALTER TABLE documents
  ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX documents_public_id_idx
  ON documents (public_id);
