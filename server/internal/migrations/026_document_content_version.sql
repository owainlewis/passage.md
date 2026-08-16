-- Content version for conflict-safe document writes.
--
-- People and agents update the same documents. Without a version the server
-- cannot tell a fresh write from one based on a body the client loaded before
-- somebody else changed it, so the later write silently wins.
--
-- Additive and safe while the previous application version is still serving:
-- existing rows adopt version 1 and clients that omit the version keep the
-- unconditional update path.
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS content_version integer NOT NULL DEFAULT 1;
