# Production incident runbook

Project: `passage-md-prod`.

Region: `us-central1`.

Cloud Run service: `passage-md`.

Cloud SQL instance: `passage-md-postgres`.

Do not paste cookies, API tokens, password-reset links, document bodies, Stripe secrets, or webhook payloads into logs, issues, or chat.

## Confirm impact

```sh
curl -i https://passage.md/api/health
gcloud run services describe passage-md \
  --project passage-md-prod \
  --region us-central1 \
  --format='yaml(status.url,status.latestReadyRevisionName,status.traffic)'
gcloud sql instances describe passage-md-postgres \
  --project passage-md-prod \
  --format='yaml(state,region,settings.tier)'
```

A healthy response is HTTP 200 with `{"database":"ok","status":"ok"}`.

Open the `Passage production` Cloud Monitoring dashboard and check request volume, 5xx responses, p95 latency, active instances, database utilization, connections, and availability.

## Query safe application errors

```sh
gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="passage-md"
   AND severity>=ERROR' \
  --project passage-md-prod \
  --freshness=1h \
  --limit=100 \
  --format='table(timestamp,jsonPayload.request_id,jsonPayload.route,jsonPayload.operation,jsonPayload.error)'
```

Use `jsonPayload.request_id` to correlate an application error with the Cloud Run request log.

Stripe application failures include only `stripe_event_id` and `stripe_event_type`.

Check the matching event in Stripe Workbench for its delivery attempts and response codes.

Never copy the webhook payload into Passage logs.

### Read only recent Checkout creation errors

When direct Cloud access is unavailable, dispatch `Production Checkout diagnostics` from `main`.

Set `lookback_minutes` from 1 to 120.

The workflow uses the reviewed production workload identity and queries only structured errors whose operation is `create Stripe Checkout session`.

It outputs only the timestamp, severity, serving revision, operation, redacted error text, and request ID.

It does not read request bodies, headers, user accounts, Stripe secrets, webhook payloads, or database data.

## Roll back Cloud Run

List known-good revisions and their commit labels:

```sh
gcloud run revisions list \
  --project passage-md-prod \
  --region us-central1 \
  --service passage-md \
  --format='table(metadata.name,metadata.labels.commit-sha,metadata.creationTimestamp)'
```

Send traffic to the chosen previous revision:

```sh
gcloud run services update-traffic passage-md \
  --project passage-md-prod \
  --region us-central1 \
  --to-revisions REVISION_NAME=100
```

Recheck `/api/health`.

Record the revision and reason in the incident issue.

Return to normal deployment traffic only after the fix is deployed:

```sh
gcloud run services update-traffic passage-md \
  --project passage-md-prod \
  --region us-central1 \
  --to-latest
```

## Recover the database

Do not restore over production.

Confirm the latest successful backup and point-in-time recovery window:

```sh
gcloud sql backups list \
  --project passage-md-prod \
  --instance passage-md-postgres
gcloud sql instances describe passage-md-postgres \
  --project passage-md-prod \
  --format='yaml(settings.backupConfiguration)'
```

Clone to a separate recovery instance at a timestamp before the incident:

```sh
gcloud sql instances clone passage-md-postgres passage-md-postgres-recovery \
  --project passage-md-prod \
  --point-in-time 'RFC3339_TIMESTAMP'
```

Validate migrations and record counts without selecting document bodies, password hashes, session data, API-token hashes, or reset-token hashes.

Coordinate a controlled cutover only after validation.

Follow issue #153 for the tested recovery procedure and retention assumptions.

## Disable billing

For an immediate emergency stop, disable billing before investigating:

```sh
gcloud run services update passage-md \
  --project passage-md-prod \
  --region us-central1 \
  --update-env-vars STRIPE_BILLING_ENABLED=false
```

Confirm checkout and webhook endpoints return service unavailable, while `/api/health` stays healthy.

Then run the audited full disable from exact `main`:

```sh
gh workflow run CI \
  --repo owainlewis/passage.md \
  --ref main \
  -f stripe_billing_mode=disable
```

The full disable deploys with `STRIPE_BILLING_ENABLED=false` and removes `STRIPE_MONTHLY_PRICE_ID`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET` from the new Cloud Run revision.

Confirm the workflow is green, `/api/health` stays healthy, public registration remains closed, and the billing endpoints return the disabled response.

An explicit deployment with Stripe billing mode `preserve` does not write or bind Stripe configuration, so it does not undo the emergency toggle or reintroduce removed credentials.
Pushes to `main` do not publish an image or deploy.

Do not restore billing with a direct `gcloud` toggle.

The `enable` workflow mode requires all five repository variables to identify one reviewed Stripe account:

- `STRIPE_MONTHLY_PRICE_ID`
- `STRIPE_SECRET_KEY_SECRET`
- `STRIPE_SECRET_KEY_VERSION`
- `STRIPE_WEBHOOK_SECRET_SECRET`
- `STRIPE_WEBHOOK_SECRET_VERSION`

Secret values remain only in Secret Manager.

Versions must be fixed positive integers, not `latest`.

Restore billing only after the variables point to the intended account, Stripe delivery and stored entitlements are reconciled, the change is reviewed, and activation is explicitly approved.

In Stripe Workbench, check webhook delivery status by event ID, confirm the endpoint URL, and retry only events whose database effect is understood.

## Deployment failures

Failed manual `CI` workflow dispatches create or update an assigned `Production deployment failed` GitHub issue with the failing run URL.

Failed pull-request or `main` push CI does not represent a production deployment failure because those events cannot publish an image, run migrations, or deploy.

Inspect the failing job before retrying.

If production changed before failure, compare the active Cloud Run revision with the workflow commit and roll back when needed.

### Migration gate

Production application instances never apply migrations during startup.

An explicit `CI` workflow dispatch from `main` builds and pushes one commit-tagged image, configures the `passage-md-migrate` Cloud Run Job to use that image, runs one migration task with no retries, and waits for success.
It then deploys a ready application revision without traffic, resolves that exact revision name, and pins 100% traffic to it as the final step.

If the migration job fails, the workflow exits before `gcloud run deploy`.
The existing application revision and traffic remain unchanged.

Inspect recent executions without printing environment values:

```sh
gcloud run jobs executions list \
  --project passage-md-prod \
  --region us-central1 \
  --job passage-md-migrate
```

The migration runner retains its PostgreSQL advisory lock.
A manual retry is safe after the cause is understood because applied migration versions are recorded in `schema_migrations`.

During database recovery, `PASSAGE_WRITES_DISABLED` fences application mutations only.
It does not suppress or trigger migrations because the application no longer runs them.
Do not execute the migration job against a recovery database unless the recovery plan explicitly requires it.

### Application rollback versus schema rollback

Moving traffic to an earlier Cloud Run revision does not reverse database migrations.

Before deployment, migrations must remain compatible with both the previous and new application revisions.
If a schema change causes an incident, prefer a forward fix.
Use point-in-time recovery to a separate database only when a forward fix is unsafe, then follow the controlled database recovery procedure above.

Never attempt an automatic down migration in production.
