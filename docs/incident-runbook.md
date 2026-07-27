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

If checkout or webhook processing could create bad state, disable billing without deleting Stripe secrets:

```sh
gcloud run services update passage-md \
  --project passage-md-prod \
  --region us-central1 \
  --update-env-vars STRIPE_BILLING_ENABLED=false
```

Confirm checkout and webhook endpoints return service unavailable, while `/api/health` stays healthy.

Re-enable billing through the normal deployment configuration after Stripe delivery and stored entitlements are reconciled.

In Stripe Workbench, check webhook delivery status by event ID, confirm the endpoint URL, and retry only events whose database effect is understood.

## Deployment failures

Failed `main` CI runs create or update an assigned `Production deployment failed` GitHub issue with the failing run URL.

Inspect the failing job before retrying.

If production changed before failure, compare the active Cloud Run revision with the workflow commit and roll back when needed.
