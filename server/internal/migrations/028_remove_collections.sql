-- Remove collections.
--
-- Every document already belongs to one owner-wide list; a collection was
-- only a label on top of it. Dropping the column moves every document out of
-- its collection without touching its body, sharing, star or timestamps, and
-- archived documents are left exactly as they were.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- Dropping the column also drops the owner-scoped foreign key and both
-- collection indexes on documents.
ALTER TABLE documents DROP COLUMN IF EXISTS collection_id;

DROP TRIGGER IF EXISTS collections_keep_slug_immutable ON collections;
DROP FUNCTION IF EXISTS keep_collection_slug_immutable();
DROP TABLE IF EXISTS collections;
