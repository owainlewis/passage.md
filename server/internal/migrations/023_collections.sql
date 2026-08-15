CREATE TABLE collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  description text CHECK (description IS NULL OR char_length(description) <= 180),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, slug),
  UNIQUE (owner_user_id, id)
);

CREATE INDEX collections_owner_created_idx
  ON collections (owner_user_id, created_at, id);

ALTER TABLE documents
  ADD COLUMN collection_id uuid,
  ADD COLUMN starred boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT documents_owned_collection_fk
    FOREIGN KEY (owner_user_id, collection_id)
    REFERENCES collections (owner_user_id, id);

CREATE INDEX documents_owner_collection_idx
  ON documents (owner_user_id, collection_id, updated_at DESC, id DESC)
  WHERE archived_at IS NULL;

CREATE INDEX documents_owner_starred_idx
  ON documents (owner_user_id, updated_at DESC, id DESC)
  WHERE archived_at IS NULL AND starred;

CREATE FUNCTION create_default_collections_for_user() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO collections (owner_user_id, slug, title, description)
  VALUES
    (NEW.id, 'operating-context', 'Operating Context', 'Stable context, instructions, and decisions shared with agents.'),
    (NEW.id, 'content-studio', 'Content Studio', 'Ideas, drafts, and published work in progress.'),
    (NEW.id, 'passage', 'Passage', 'Product notes, plans, and working documents for Passage.'),
    (NEW.id, 'research', 'Research', 'Sources, findings, and notes worth returning to.')
  ON CONFLICT (owner_user_id, slug) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_create_default_collections
AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION create_default_collections_for_user();

INSERT INTO collections (owner_user_id, slug, title, description)
SELECT users.id, defaults.slug, defaults.title, defaults.description
FROM users
CROSS JOIN (VALUES
  ('operating-context', 'Operating Context', 'Stable context, instructions, and decisions shared with agents.'),
  ('content-studio', 'Content Studio', 'Ideas, drafts, and published work in progress.'),
  ('passage', 'Passage', 'Product notes, plans, and working documents for Passage.'),
  ('research', 'Research', 'Sources, findings, and notes worth returning to.')
) AS defaults(slug, title, description)
ON CONFLICT (owner_user_id, slug) DO NOTHING;

CREATE FUNCTION keep_collection_slug_immutable() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'collection slug is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER collections_keep_slug_immutable
BEFORE UPDATE OF slug ON collections
FOR EACH ROW EXECUTE FUNCTION keep_collection_slug_immutable();
