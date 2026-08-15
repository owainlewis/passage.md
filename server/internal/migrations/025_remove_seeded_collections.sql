SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- The existing collection index excludes archived documents and starts with
-- owner_user_id. This complete foreign-key index keeps both this bulk cleanup
-- and later collection deletes from scanning documents once per deleted row.
CREATE INDEX IF NOT EXISTS documents_collection_id_fk_idx
  ON documents (collection_id)
  WHERE collection_id IS NOT NULL;

DROP TRIGGER IF EXISTS users_create_default_collections ON users;
DROP FUNCTION IF EXISTS create_default_collections_for_user();

CREATE TEMP TABLE seeded_collections_to_remove (
  id uuid PRIMARY KEY
) ON COMMIT DROP;

-- now() is stable for a PostgreSQL transaction. Migration 023 therefore gave
-- backfilled seeds the same timestamp as its schema_migrations row, while the
-- trigger gave new-account seeds the same timestamp as the owning user row.
-- Requiring that origin timestamp, the exact seed values, and untouched row
-- timestamps preserves later user-created lookalikes and edited collections.
INSERT INTO seeded_collections_to_remove (id)
SELECT collections.id
FROM collections
JOIN users ON users.id = collections.owner_user_id
JOIN (VALUES
  ('operating-context', 'Operating Context', 'Stable context, instructions, and decisions shared with agents.'),
  ('content-studio', 'Content Studio', 'Ideas, drafts, and published work in progress.'),
  ('passage', 'Passage', 'Product notes, plans, and working documents for Passage.'),
  ('research', 'Research', 'Sources, findings, and notes worth returning to.')
) AS seeds(slug, title, description)
  ON seeds.slug = collections.slug
  AND seeds.title = collections.title
  AND seeds.description = collections.description
WHERE collections.created_at = collections.updated_at
  AND (
    collections.created_at = users.created_at
    OR collections.created_at = (
      SELECT applied_at
      FROM schema_migrations
      WHERE version = '023_collections'
    )
  )
FOR UPDATE OF collections;

UPDATE documents
SET collection_id = NULL
WHERE collection_id IN (SELECT id FROM seeded_collections_to_remove);

DELETE FROM collections
WHERE id IN (SELECT id FROM seeded_collections_to_remove);
