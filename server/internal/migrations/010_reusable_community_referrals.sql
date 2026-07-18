DROP TABLE community_access_codes;

CREATE TABLE community_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  code_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  disabled_at timestamptz,
  CHECK (slug = lower(slug)),
  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE TABLE community_grants (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  referral_id uuid NOT NULL REFERENCES community_referrals(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revocation_reason text,
  CHECK ((revoked_at IS NULL) = (revocation_reason IS NULL))
);

CREATE INDEX community_grants_referral_idx ON community_grants (referral_id);
