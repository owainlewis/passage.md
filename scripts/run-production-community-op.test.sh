#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
temporary_dir="$(mktemp -d)"
trap 'rm -rf "${temporary_dir}"' EXIT

export CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT="passage-run@test.iam.gserviceaccount.com"
export CLOUD_RUN_SERVICE="passage-test"
export CLOUD_SQL_INSTANCE="test:region:database"
export COMMIT_SHA="0123456789abcdef0123456789abcdef01234567"
export DATABASE_SECRET="passage-test-database-url"
export GCP_PROJECT_ID="passage-test"
export GCP_REGION="us-central1"
export GITHUB_REF="refs/heads/main"
export GITHUB_RUN_ATTEMPT="1"
export GITHUB_RUN_ID="123456"
export IMAGE="us-central1-docker.pkg.dev/passage-test/passage/passage:${COMMIT_SHA}"
export PASSAGE_IMAGE_DIGEST="sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
export PASSAGE_GCLOUD_LOG="${temporary_dir}/gcloud.log"
export PATH="${script_dir}/testdata:${PATH}"

assert_common_job_contract() {
  [[ "$(wc -l <"${PASSAGE_GCLOUD_LOG}" | tr -d ' ')" -eq 8 ]]
  image_check="$(sed -n '1p' "${PASSAGE_GCLOUD_LOG}")"
  first_service_check="$(sed -n '2p' "${PASSAGE_GCLOUD_LOG}")"
  first_revision_check="$(sed -n '3p' "${PASSAGE_GCLOUD_LOG}")"
  job_deploy="$(sed -n '4p' "${PASSAGE_GCLOUD_LOG}")"
  second_service_check="$(sed -n '5p' "${PASSAGE_GCLOUD_LOG}")"
  second_revision_check="$(sed -n '6p' "${PASSAGE_GCLOUD_LOG}")"
  job_execute="$(sed -n '7p' "${PASSAGE_GCLOUD_LOG}")"
  job_delete="$(sed -n '8p' "${PASSAGE_GCLOUD_LOG}")"

  [[ "${image_check}" == "artifacts docker images describe ${IMAGE} "* ]]
  [[ "${first_service_check}" == "run services describe ${CLOUD_RUN_SERVICE} "* ]]
  [[ "${first_revision_check}" == "run revisions describe passage-test-00001-test "* ]]
  [[ "${job_deploy}" == "run jobs deploy passage-md-ops-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT} "* ]]
  [[ "${job_deploy}" == *"--image=${IMAGE%:${COMMIT_SHA}}@${PASSAGE_IMAGE_DIGEST}"* ]]
  [[ "${job_deploy}" == *"--service-account=${CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT}"* ]]
  [[ "${job_deploy}" == *"--set-cloudsql-instances=${CLOUD_SQL_INSTANCE}"* ]]
  [[ "${job_deploy}" == *"--set-secrets=DATABASE_URL=${DATABASE_SECRET}:latest"* ]]
  [[ "${job_deploy}" == *"--set-env-vars=APP_ENV=production,PASSAGE_DATABASE_MAX_CONNS=1,PASSAGE_WRITES_DISABLED=false"* ]]
  [[ "${job_deploy}" == *"--tasks=1"* ]]
  [[ "${job_deploy}" == *"--max-retries=0"* ]]
  [[ "${job_deploy}" == *"--task-timeout=2m"* ]]
  [[ "${second_service_check}" == "run services describe ${CLOUD_RUN_SERVICE} "* ]]
  [[ "${second_revision_check}" == "run revisions describe passage-test-00001-test "* ]]
  [[ "${job_execute}" == "run jobs execute passage-md-ops-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT} "* ]]
  [[ "${job_execute}" == *"--wait"* ]]
  [[ "${job_delete}" == "run jobs delete passage-md-ops-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT} "* ]]
}

export OPERATION="create-referral"
export REFERRAL_SLUG="launch-test"
export REFERRAL_NAME="Passage launch test"
export REFERRAL_CODE_SHA256="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
"${script_dir}/run-production-community-op.sh"
assert_common_job_contract
[[ "$(sed -n '4p' "${PASSAGE_GCLOUD_LOG}")" == *"--args=community,referral,create,launch-test,Passage launch test,--code-sha256,${REFERRAL_CODE_SHA256}"* ]]

: >"${PASSAGE_GCLOUD_LOG}"
export OPERATION="disable-referral"
"${script_dir}/run-production-community-op.sh"
assert_common_job_contract
[[ "$(sed -n '4p' "${PASSAGE_GCLOUD_LOG}")" == *"--args=community,referral,disable,${REFERRAL_SLUG}"* ]]

: >"${PASSAGE_GCLOUD_LOG}"
export OPERATION="revoke-grant"
export ACCOUNT_EMAIL="OWAIN@gradientwork.com"
export CONFIRM_EMAIL="owain@gradientwork.com"
export REVOCATION_REASON="launch payment test"
"${script_dir}/run-production-community-op.sh"
assert_common_job_contract
[[ "$(sed -n '4p' "${PASSAGE_GCLOUD_LOG}")" == *"--args=community,grant,revoke,owain@gradientwork.com,--reason,launch payment test"* ]]

: >"${PASSAGE_GCLOUD_LOG}"
export OPERATION="create-referral"
export REFERRAL_CODE_SHA256="PASS-PLAINTEXT"
if "${script_dir}/run-production-community-op.sh"; then
  echo "operation accepted a plaintext referral code" >&2
  exit 1
fi
[[ ! -s "${PASSAGE_GCLOUD_LOG}" ]]

: >"${PASSAGE_GCLOUD_LOG}"
export IMAGE="us-central1-docker.pkg.dev/passage-test/passage/passage:${COMMIT_SHA}"
export REFERRAL_CODE_SHA256="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
export PASSAGE_SERVICE_WRITES_DISABLED="true"
if "${script_dir}/run-production-community-op.sh"; then
  echo "operation bypassed the production write fence" >&2
  exit 1
fi
[[ "$(wc -l <"${PASSAGE_GCLOUD_LOG}" | tr -d ' ')" -eq 4 ]]
[[ "$(sed -n '4p' "${PASSAGE_GCLOUD_LOG}")" == "run jobs delete "* ]]

: >"${PASSAGE_GCLOUD_LOG}"
unset PASSAGE_SERVICE_WRITES_DISABLED
export PASSAGE_SERVICE_PUBLIC_SIGNUP_ENABLED="true"
if "${script_dir}/run-production-community-op.sh"; then
  echo "operation ran while public signup was enabled" >&2
  exit 1
fi
[[ "$(wc -l <"${PASSAGE_GCLOUD_LOG}" | tr -d ' ')" -eq 4 ]]
[[ "$(sed -n '4p' "${PASSAGE_GCLOUD_LOG}")" == "run jobs delete "* ]]

: >"${PASSAGE_GCLOUD_LOG}"
unset PASSAGE_SERVICE_PUBLIC_SIGNUP_ENABLED
export GITHUB_REF="refs/heads/topic"
if "${script_dir}/run-production-community-op.sh"; then
  echo "operation ran outside main" >&2
  exit 1
fi
[[ ! -s "${PASSAGE_GCLOUD_LOG}" ]]

: >"${PASSAGE_GCLOUD_LOG}"
export GITHUB_REF="refs/heads/main"
export IMAGE="us-central1-docker.pkg.dev/passage-test/passage/passage:latest"
if "${script_dir}/run-production-community-op.sh"; then
  echo "operation ran an inexact image" >&2
  exit 1
fi
[[ ! -s "${PASSAGE_GCLOUD_LOG}" ]]

: >"${PASSAGE_GCLOUD_LOG}"
export IMAGE="us-central1-docker.pkg.dev/passage-test/passage/passage:${COMMIT_SHA}"
export PASSAGE_IMAGE_DIGEST="tag-not-resolved"
if "${script_dir}/run-production-community-op.sh"; then
  echo "operation ran without an exact image digest" >&2
  exit 1
fi
[[ "$(wc -l <"${PASSAGE_GCLOUD_LOG}" | tr -d ' ')" -eq 2 ]]
[[ "$(sed -n '2p' "${PASSAGE_GCLOUD_LOG}")" == "run jobs delete "* ]]

: >"${PASSAGE_GCLOUD_LOG}"
export PASSAGE_IMAGE_DIGEST="sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
export PASSAGE_SERVICE_TRAFFIC_PERCENT="50"
if "${script_dir}/run-production-community-op.sh"; then
  echo "operation ran without one 100-percent serving revision" >&2
  exit 1
fi
[[ "$(wc -l <"${PASSAGE_GCLOUD_LOG}" | tr -d ' ')" -eq 3 ]]
[[ "$(sed -n '3p' "${PASSAGE_GCLOUD_LOG}")" == "run jobs delete "* ]]

: >"${PASSAGE_GCLOUD_LOG}"
unset PASSAGE_SERVICE_TRAFFIC_PERCENT
export PASSAGE_SERVICE_COMMIT_SHA="abcdef0123456789abcdef0123456789abcdef01"
if "${script_dir}/run-production-community-op.sh"; then
  echo "operation ran against a serving revision from another commit" >&2
  exit 1
fi
[[ "$(wc -l <"${PASSAGE_GCLOUD_LOG}" | tr -d ' ')" -eq 4 ]]
[[ "$(sed -n '4p' "${PASSAGE_GCLOUD_LOG}")" == "run jobs delete "* ]]

: >"${PASSAGE_GCLOUD_LOG}"
unset PASSAGE_SERVICE_COMMIT_SHA
unset PASSAGE_SERVICE_WRITES_DISABLED
export PASSAGE_FAIL_JOB_DELETE="true"
if "${script_dir}/run-production-community-op.sh"; then
  echo "operation hid ephemeral job cleanup failure" >&2
  exit 1
fi
[[ "$(wc -l <"${PASSAGE_GCLOUD_LOG}" | tr -d ' ')" -eq 8 ]]
[[ "$(sed -n '8p' "${PASSAGE_GCLOUD_LOG}")" == "run jobs delete "* ]]
