CREATE TABLE magic_link_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX magic_link_tokens_user_id_idx ON magic_link_tokens(user_id);

CREATE INDEX magic_link_tokens_token_hash_active_idx
  ON magic_link_tokens (token_hash)
  WHERE used_at IS NULL;
