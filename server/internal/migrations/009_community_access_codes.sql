CREATE TABLE community_access_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL UNIQUE,
  batch_label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  redeemed_user_id uuid UNIQUE REFERENCES users(id),
  redeemed_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  CHECK ((redeemed_user_id IS NULL) = (redeemed_at IS NULL)),
  CHECK (revoked_at IS NULL OR redeemed_user_id IS NOT NULL)
);

CREATE INDEX community_access_codes_active_grant_idx
  ON community_access_codes (redeemed_user_id)
  WHERE redeemed_user_id IS NOT NULL AND revoked_at IS NULL;
