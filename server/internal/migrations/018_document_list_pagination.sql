CREATE INDEX IF NOT EXISTS documents_owner_active_page_idx
  ON documents (owner_user_id, updated_at DESC, id DESC)
  WHERE archived_at IS NULL;
