#!/usr/bin/env bash
set -euo pipefail

required_variables=(
  APP_BASE_URL
  CLOUD_RUN_MIGRATION_JOB
  CLOUD_RUN_MAX_INSTANCES
  CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT
  CLOUD_RUN_SERVICE
  CLOUD_SQL_INSTANCE
  COMMIT_SHA
  DATABASE_SECRET
  DATABASE_MAX_CONNS
  GCP_PROJECT_ID
  GCP_REGION
  IMAGE
  PUBLIC_SIGNUP_ENABLED
  RESEND_FROM
)

for variable in "${required_variables[@]}"; do
  if [[ -z "${!variable:-}" ]]; then
    echo "${variable} is required" >&2
    exit 1
  fi
done

gcloud run jobs deploy "${CLOUD_RUN_MIGRATION_JOB}" \
  --project="${GCP_PROJECT_ID}" \
  --region="${GCP_REGION}" \
  --image="${IMAGE}" \
  --service-account="${CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT}" \
  --set-cloudsql-instances="${CLOUD_SQL_INSTANCE}" \
  --set-secrets="DATABASE_URL=${DATABASE_SECRET}:latest" \
  --args=migrate \
  --tasks=1 \
  --max-retries=0 \
  --task-timeout=10m \
  --labels="commit-sha=${COMMIT_SHA}" \
  --quiet

gcloud run jobs execute "${CLOUD_RUN_MIGRATION_JOB}" \
  --project="${GCP_PROJECT_ID}" \
  --region="${GCP_REGION}" \
  --wait \
  --quiet

deployed_revision="$(
  gcloud run deploy "${CLOUD_RUN_SERVICE}" \
    --project="${GCP_PROJECT_ID}" \
    --region="${GCP_REGION}" \
    --image="${IMAGE}" \
    --update-env-vars="APP_ENV=production,APP_BASE_URL=${APP_BASE_URL},GCP_PROJECT_ID=${GCP_PROJECT_ID},PASSAGE_DATABASE_MAX_CONNS=${DATABASE_MAX_CONNS},PASSAGE_PUBLIC_SIGNUP_ENABLED=${PUBLIC_SIGNUP_ENABLED},RESEND_FROM=${RESEND_FROM}" \
    --update-secrets="RESEND_API_KEY=passage-resend-api-key:latest" \
    --no-cpu-throttling \
    --min=1 \
    --max="${CLOUD_RUN_MAX_INSTANCES}" \
    --update-labels="commit-sha=${COMMIT_SHA}" \
    --no-traffic \
    --format='value(status.latestCreatedRevisionName)' \
    --quiet
)"

if [[ -z "${deployed_revision}" ]]; then
  echo "Cloud Run did not return the deployed revision name" >&2
  exit 1
fi

gcloud run services update-traffic "${CLOUD_RUN_SERVICE}" \
  --project="${GCP_PROJECT_ID}" \
  --region="${GCP_REGION}" \
  --to-revisions="${deployed_revision}=100" \
  --quiet
