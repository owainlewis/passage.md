ALTER TABLE users
  ADD COLUMN policy_version text,
  ADD COLUMN policy_accepted_at timestamptz,
  ADD CONSTRAINT users_policy_acceptance_complete
    CHECK (
      (policy_version IS NULL AND policy_accepted_at IS NULL)
      OR
      (policy_version <> '' AND policy_accepted_at IS NOT NULL)
    );
