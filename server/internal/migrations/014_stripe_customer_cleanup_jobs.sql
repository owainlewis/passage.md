CREATE TABLE stripe_customer_cleanup_jobs (
  account_email text PRIMARY KEY,
  stripe_customer_id text NOT NULL UNIQUE,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
