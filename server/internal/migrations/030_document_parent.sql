-- Derived docs: a document may sit one level under a parent.
--
-- A writer drafts a source piece once, then keeps what was made from it (a
-- newsletter, a post, a script) underneath it. parent_id is the whole
-- relationship. It is set when the child is created and never changes.
--
-- The server enforces that the parent has the same owner, is active, and has
-- no parent of its own, under a row lock at create time. The cascade only
-- matters when rows are hard-deleted, as on account deletion.
--
-- Additive and safe while the previous application version is still serving:
-- existing rows keep a NULL parent and stay top-level documents.
SET LOCAL lock_timeout = '5s';

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES documents (id) ON DELETE CASCADE;

-- Children are always read for a known set of parents.
CREATE INDEX IF NOT EXISTS documents_parent_idx
  ON documents (parent_id)
  WHERE parent_id IS NOT NULL;
