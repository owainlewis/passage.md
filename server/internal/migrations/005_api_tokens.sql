CREATE TABLE api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX api_tokens_user_active_idx
  ON api_tokens (user_id, created_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX api_tokens_token_hash_active_idx
  ON api_tokens (token_hash)
  WHERE revoked_at IS NULL;
