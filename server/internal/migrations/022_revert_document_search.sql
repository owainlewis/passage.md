DROP INDEX IF EXISTS documents_active_search_idx;

ALTER TABLE abuse_rate_limits
  DROP CONSTRAINT abuse_rate_limits_scope_check;

DELETE FROM abuse_rate_limits
WHERE scope = 'document_search';

ALTER TABLE abuse_rate_limits
  ADD CONSTRAINT abuse_rate_limits_scope_check CHECK (scope IN (
    'auth_mutation',
    'document_mutation',
    'api_token',
    'shared_html',
    'raw_markdown'
  ));
