#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
temporary_dir="$(mktemp -d)"
trap 'rm -rf "${temporary_dir}"' EXIT

export APP_BASE_URL="https://passage.test"
export CLOUD_RUN_MIGRATION_JOB="passage-migrate-test"
export CLOUD_RUN_MAX_INSTANCES="4"
export CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT="passage-run@test.iam.gserviceaccount.com"
export CLOUD_RUN_SERVICE="passage-test"
export CLOUD_SQL_INSTANCE="test:region:database"
export COMMIT_SHA="0123456789abcdef"
export DATABASE_SECRET="passage-test-database-url"
export DATABASE_MAX_CONNS="3"
export GCP_PROJECT_ID="passage-test"
export GCP_REGION="us-central1"
export IMAGE="us-central1-docker.pkg.dev/passage-test/passage/passage:0123456789abcdef"
export PASSAGE_DEPLOYED_REVISION="passage-test-00001-test"
export PUBLIC_SIGNUP_ENABLED="false"
export PASSAGE_GCLOUD_LOG="${temporary_dir}/gcloud.log"
export PATH="${script_dir}/testdata:${PATH}"
export RESEND_FROM="passage.test <mail@passage.test>"
export STRIPE_BILLING_MODE="preserve"
export STRIPE_MONTHLY_PRICE_ID="price_live_monthly"
export STRIPE_SECRET_KEY_SECRET="passage-test-stripe-secret-key"
export STRIPE_SECRET_KEY_VERSION="1"
export STRIPE_WEBHOOK_SECRET_SECRET="passage-test-stripe-webhook-secret"
export STRIPE_WEBHOOK_SECRET_VERSION="1"

"${script_dir}/deploy-production.sh"
[[ "$(wc -l <"${PASSAGE_GCLOUD_LOG}" | tr -d ' ')" -eq 4 ]]
job_deploy="$(sed -n '1p' "${PASSAGE_GCLOUD_LOG}")"
job_execute="$(sed -n '2p' "${PASSAGE_GCLOUD_LOG}")"
service_deploy="$(sed -n '3p' "${PASSAGE_GCLOUD_LOG}")"
traffic_update="$(sed -n '4p' "${PASSAGE_GCLOUD_LOG}")"

[[ "${job_deploy}" == "run jobs deploy ${CLOUD_RUN_MIGRATION_JOB} "* ]]
[[ "${job_deploy}" == *"--project=${GCP_PROJECT_ID}"* ]]
[[ "${job_deploy}" == *"--region=${GCP_REGION}"* ]]
[[ "${job_deploy}" == *"--image=${IMAGE}"* ]]
[[ "${job_deploy}" == *"--service-account=${CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT}"* ]]
[[ "${job_deploy}" == *"--set-cloudsql-instances=${CLOUD_SQL_INSTANCE}"* ]]
[[ "${job_deploy}" == *"--set-secrets=DATABASE_URL=${DATABASE_SECRET}:latest"* ]]
[[ "${job_deploy}" == *"--args=migrate"* ]]
[[ "${job_deploy}" == *"--tasks=1"* ]]
[[ "${job_deploy}" == *"--max-retries=0"* ]]
[[ "${job_deploy}" == *"--task-timeout=10m"* ]]
[[ "${job_deploy}" == *"--labels=commit-sha=${COMMIT_SHA}"* ]]

[[ "${job_execute}" == "run jobs execute ${CLOUD_RUN_MIGRATION_JOB} "* ]]
[[ "${job_execute}" == *"--project=${GCP_PROJECT_ID}"* ]]
[[ "${job_execute}" == *"--region=${GCP_REGION}"* ]]
[[ "${job_execute}" == *"--wait"* ]]

[[ "${service_deploy}" == "run deploy ${CLOUD_RUN_SERVICE} "* ]]
[[ "${service_deploy}" == *"--project=${GCP_PROJECT_ID}"* ]]
[[ "${service_deploy}" == *"--region=${GCP_REGION}"* ]]
[[ "${service_deploy}" == *"--image=${IMAGE}"* ]]
[[ "${service_deploy}" == *"--update-env-vars=APP_ENV=production,APP_BASE_URL=${APP_BASE_URL},GCP_PROJECT_ID=${GCP_PROJECT_ID},PASSAGE_DATABASE_MAX_CONNS=${DATABASE_MAX_CONNS},PASSAGE_PUBLIC_SIGNUP_ENABLED=false,RESEND_FROM=${RESEND_FROM},STRIPE_MONTHLY_PRICE_ID=${STRIPE_MONTHLY_PRICE_ID}"* ]]
[[ "${service_deploy}" != *"STRIPE_BILLING_ENABLED="* ]]
[[ "${service_deploy}" == *"--update-secrets=RESEND_API_KEY=passage-resend-api-key:latest,STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY_SECRET}:1,STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET_SECRET}:1"* ]]
[[ "${service_deploy}" == *"--no-cpu-throttling"* ]]
[[ "${service_deploy}" == *"--min=1"* ]]
[[ "${service_deploy}" == *"--max=${CLOUD_RUN_MAX_INSTANCES}"* ]]
[[ "${service_deploy}" == *"--update-labels=commit-sha=${COMMIT_SHA}"* ]]
[[ "${service_deploy}" == *"--no-traffic"* ]]
[[ "${service_deploy}" == *"--deploy-health-check"* ]]
[[ "${service_deploy}" == *"--format=value(status.latestCreatedRevisionName)"* ]]

[[ "${traffic_update}" == "run services update-traffic ${CLOUD_RUN_SERVICE} "* ]]
[[ "${traffic_update}" == *"--project=${GCP_PROJECT_ID}"* ]]
[[ "${traffic_update}" == *"--region=${GCP_REGION}"* ]]
[[ "${traffic_update}" == *"--to-revisions=${PASSAGE_DEPLOYED_REVISION}=100"* ]]

: >"${PASSAGE_GCLOUD_LOG}"
export PASSAGE_FAIL_MIGRATION=true
if "${script_dir}/deploy-production.sh"; then
  echo "deployment succeeded after a failed migration" >&2
  exit 1
fi
[[ "$(wc -l <"${PASSAGE_GCLOUD_LOG}" | tr -d ' ')" -eq 2 ]]
[[ "$(sed -n '1p' "${PASSAGE_GCLOUD_LOG}")" == "run jobs deploy "* ]]
[[ "$(sed -n '2p' "${PASSAGE_GCLOUD_LOG}")" == "run jobs execute "* ]]

: >"${PASSAGE_GCLOUD_LOG}"
unset PASSAGE_FAIL_MIGRATION
export PASSAGE_EMPTY_REVISION=true
if "${script_dir}/deploy-production.sh"; then
  echo "deployment succeeded without a resolved revision" >&2
  exit 1
fi
[[ "$(wc -l <"${PASSAGE_GCLOUD_LOG}" | tr -d ' ')" -eq 3 ]]
[[ "$(sed -n '3p' "${PASSAGE_GCLOUD_LOG}")" == "run deploy "* ]]

: >"${PASSAGE_GCLOUD_LOG}"
unset PASSAGE_EMPTY_REVISION
export PASSAGE_FAIL_SERVICE_DEPLOY=true
if "${script_dir}/deploy-production.sh"; then
  echo "deployment succeeded after the service deployment health check failed" >&2
  exit 1
fi
[[ "$(wc -l <"${PASSAGE_GCLOUD_LOG}" | tr -d ' ')" -eq 3 ]]
[[ "$(sed -n '3p' "${PASSAGE_GCLOUD_LOG}")" == "run deploy "* ]]

: >"${PASSAGE_GCLOUD_LOG}"
unset PASSAGE_FAIL_SERVICE_DEPLOY
unset STRIPE_WEBHOOK_SECRET_SECRET
if "${script_dir}/deploy-production.sh"; then
  echo "deployment succeeded without the Stripe webhook secret name" >&2
  exit 1
fi
[[ ! -s "${PASSAGE_GCLOUD_LOG}" ]]

: >"${PASSAGE_GCLOUD_LOG}"
export STRIPE_WEBHOOK_SECRET_SECRET="passage-test-stripe-webhook-secret"
export STRIPE_BILLING_MODE="enable"
"${script_dir}/deploy-production.sh"
enabled_service_deploy="$(sed -n '3p' "${PASSAGE_GCLOUD_LOG}")"
[[ "${enabled_service_deploy}" == *"STRIPE_BILLING_ENABLED=true"* ]]

: >"${PASSAGE_GCLOUD_LOG}"
export STRIPE_BILLING_MODE="disable"
"${script_dir}/deploy-production.sh"
disabled_service_deploy="$(sed -n '3p' "${PASSAGE_GCLOUD_LOG}")"
[[ "${disabled_service_deploy}" == *"STRIPE_BILLING_ENABLED=false"* ]]

: >"${PASSAGE_GCLOUD_LOG}"
export STRIPE_BILLING_MODE="invalid"
if "${script_dir}/deploy-production.sh"; then
  echo "deployment succeeded with an invalid Stripe billing mode" >&2
  exit 1
fi
[[ ! -s "${PASSAGE_GCLOUD_LOG}" ]]
