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
  STRIPE_BILLING_MODE
  STRIPE_MONTHLY_PRICE_ID
  STRIPE_SECRET_KEY_SECRET
  STRIPE_SECRET_KEY_VERSION
  STRIPE_WEBHOOK_SECRET_SECRET
  STRIPE_WEBHOOK_SECRET_VERSION
)

for variable in "${required_variables[@]}"; do
  if [[ -z "${!variable:-}" ]]; then
    echo "${variable} is required" >&2
    exit 1
  fi
done

service_env_vars="APP_ENV=production,APP_BASE_URL=${APP_BASE_URL},GCP_PROJECT_ID=${GCP_PROJECT_ID},PASSAGE_DATABASE_MAX_CONNS=${DATABASE_MAX_CONNS},PASSAGE_PUBLIC_SIGNUP_ENABLED=${PUBLIC_SIGNUP_ENABLED},RESEND_FROM=${RESEND_FROM},STRIPE_MONTHLY_PRICE_ID=${STRIPE_MONTHLY_PRICE_ID}"
case "${STRIPE_BILLING_MODE}" in
  preserve)
    ;;
  enable)
    service_env_vars+=",STRIPE_BILLING_ENABLED=true"
    ;;
  disable)
    service_env_vars+=",STRIPE_BILLING_ENABLED=false"
    ;;
  *)
    echo "STRIPE_BILLING_MODE must be preserve, enable, or disable" >&2
    exit 1
    ;;
esac

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
    --update-env-vars="${service_env_vars}" \
    --update-secrets="RESEND_API_KEY=passage-resend-api-key:latest,STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY_SECRET}:${STRIPE_SECRET_KEY_VERSION},STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET_SECRET}:${STRIPE_WEBHOOK_SECRET_VERSION}" \
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

revision_ready_max_attempts="${PASSAGE_REVISION_READY_MAX_ATTEMPTS:-30}"
revision_ready_poll_seconds="${PASSAGE_REVISION_READY_POLL_SECONDS:-2}"

if [[ ! "${revision_ready_max_attempts}" =~ ^[1-9][0-9]*$ ]]; then
  echo "PASSAGE_REVISION_READY_MAX_ATTEMPTS must be a positive integer" >&2
  exit 1
fi

if [[ ! "${revision_ready_poll_seconds}" =~ ^[0-9]+$ ]]; then
  echo "PASSAGE_REVISION_READY_POLL_SECONDS must be a non-negative integer" >&2
  exit 1
fi

for ((attempt = 1; attempt <= revision_ready_max_attempts; attempt++)); do
  latest_ready_revision="$(
    gcloud run services describe "${CLOUD_RUN_SERVICE}" \
      --project="${GCP_PROJECT_ID}" \
      --region="${GCP_REGION}" \
      --format='value(status.latestReadyRevisionName)'
  )"

  if [[ "${latest_ready_revision}" == "${deployed_revision}" ]]; then
    break
  fi

  if ((attempt == revision_ready_max_attempts)); then
    echo "Timed out waiting for Cloud Run revision ${deployed_revision} to become Ready after ${revision_ready_max_attempts} attempts" >&2
    exit 1
  fi
  sleep "${revision_ready_poll_seconds}"
done

gcloud run services update-traffic "${CLOUD_RUN_SERVICE}" \
  --project="${GCP_PROJECT_ID}" \
  --region="${GCP_REGION}" \
  --to-revisions="${deployed_revision}=100" \
  --quiet
