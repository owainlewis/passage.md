ALTER TABLE billing_accounts
  ADD COLUMN stripe_refresh_generation bigint NOT NULL DEFAULT 0,
  ADD COLUMN stripe_refresh_applied_generation bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT billing_accounts_refresh_generation_order
    CHECK (stripe_refresh_applied_generation <= stripe_refresh_generation);
