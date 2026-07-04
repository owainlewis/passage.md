CREATE TABLE billing_accounts (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  manual_plan text CHECK (manual_plan IN ('free', 'pro')),
  max_saved_docs integer CHECK (max_saved_docs IS NULL OR max_saved_docs >= 0),
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  stripe_subscription_status text,
  stripe_price_id text,
  stripe_current_period_end timestamptz,
  stripe_cancel_at_period_end boolean DEFAULT false,
  stripe_event_created timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX billing_accounts_stripe_customer_idx
  ON billing_accounts (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
