CREATE TABLE abuse_rate_limits (
  scope text NOT NULL CHECK (scope IN (
    'auth_mutation',
    'document_mutation',
    'api_token',
    'shared_html',
    'raw_markdown'
  )),
  key_hash text NOT NULL CHECK (length(key_hash) = 64),
  window_started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  requests integer NOT NULL CHECK (requests > 0),
  PRIMARY KEY (scope, key_hash),
  CHECK (expires_at > window_started_at)
);

CREATE INDEX abuse_rate_limits_expiry_idx
ON abuse_rate_limits (expires_at);
