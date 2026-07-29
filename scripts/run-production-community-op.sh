#!/usr/bin/env bash
set -euo pipefail

required_variables=(
  CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT
  CLOUD_RUN_SERVICE
  CLOUD_SQL_INSTANCE
  COMMIT_SHA
  DATABASE_SECRET
  GCP_PROJECT_ID
  GCP_REGION
  GITHUB_REF
  GITHUB_RUN_ATTEMPT
  GITHUB_RUN_ID
  IMAGE
  OPERATION
)

for variable in "${required_variables[@]}"; do
  if [[ -z "${!variable:-}" ]]; then
    echo "${variable} is required" >&2
    exit 1
  fi
done

if [[ "${GITHUB_REF}" != "refs/heads/main" ]]; then
  echo "production community operations must run from main" >&2
  exit 1
fi
if [[ ! "${COMMIT_SHA}" =~ ^[0-9a-f]{40}$ || "${IMAGE}" != *":${COMMIT_SHA}" ]]; then
  echo "IMAGE must identify the exact dispatched commit" >&2
  exit 1
fi
if [[ ! "${GITHUB_RUN_ID}" =~ ^[0-9]+$ || ! "${GITHUB_RUN_ATTEMPT}" =~ ^[0-9]+$ ]]; then
  echo "GitHub run identity is invalid" >&2
  exit 1
fi

command_args=()
case "${OPERATION}" in
  create-referral)
    if [[ ! "${REFERRAL_SLUG:-}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
      echo "REFERRAL_SLUG is invalid" >&2
      exit 1
    fi
    if [[ ! "${REFERRAL_NAME:-}" =~ ^[A-Za-z0-9._\ -]{1,80}$ ]]; then
      echo "REFERRAL_NAME is invalid" >&2
      exit 1
    fi
    if [[ ! "${REFERRAL_CODE_SHA256:-}" =~ ^[0-9a-f]{64}$ ]]; then
      echo "REFERRAL_CODE_SHA256 must be a lowercase SHA-256 hex digest" >&2
      exit 1
    fi
    command_args=(community referral create "${REFERRAL_SLUG}" "${REFERRAL_NAME}" --code-sha256 "${REFERRAL_CODE_SHA256}")
    ;;
  disable-referral)
    if [[ ! "${REFERRAL_SLUG:-}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
      echo "REFERRAL_SLUG is invalid" >&2
      exit 1
    fi
    command_args=(community referral disable "${REFERRAL_SLUG}")
    ;;
  revoke-grant)
    normalized_email="$(printf '%s' "${ACCOUNT_EMAIL:-}" | tr '[:upper:]' '[:lower:]')"
    normalized_confirmation="$(printf '%s' "${CONFIRM_EMAIL:-}" | tr '[:upper:]' '[:lower:]')"
    if [[ ! "${normalized_email}" =~ ^[a-z0-9._%+-]+@[a-z0-9.-]+$ || "${normalized_email}" != "${normalized_confirmation}" ]]; then
      echo "ACCOUNT_EMAIL and CONFIRM_EMAIL must be the same valid email" >&2
      exit 1
    fi
    if [[ ! "${REVOCATION_REASON:-}" =~ ^[A-Za-z0-9._\ -]{1,120}$ ]]; then
      echo "REVOCATION_REASON is invalid" >&2
      exit 1
    fi
    command_args=(community grant revoke "${normalized_email}" --reason "${REVOCATION_REASON}")
    ;;
  *)
    echo "OPERATION must be create-referral, disable-referral, or revoke-grant" >&2
    exit 1
    ;;
esac

printf -v command_args_csv '%s,' "${command_args[@]}"
command_args_csv="${command_args_csv%,}"
job_name="passage-md-ops-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"

load_serving_revision() {
  local service_json revision_json revision_commit
  service_json="$(
    gcloud run services describe "${CLOUD_RUN_SERVICE}" \
      --project="${GCP_PROJECT_ID}" \
      --region="${GCP_REGION}" \
      --format=json
  )"
  serving_revision="$(
    printf '%s' "${service_json}" |
      jq -r '[.status.traffic[]? | select((.percent // 0) == 100) | .revisionName] | unique | if length == 1 then .[0] else "" end'
  )"
  if [[ -z "${serving_revision}" ]]; then
    echo "production service must route 100 percent to one explicit revision" >&2
    exit 1
  fi

  revision_json="$(
    gcloud run revisions describe "${serving_revision}" \
      --project="${GCP_PROJECT_ID}" \
      --region="${GCP_REGION}" \
      --format=json
  )"
  revision_commit="$(printf '%s' "${revision_json}" | jq -r '.metadata.labels["commit-sha"] // ""')"
  if [[ "${revision_commit}" != "${COMMIT_SHA}" ]]; then
    echo "serving revision does not match the dispatched main commit" >&2
    exit 1
  fi

  writes_disabled="$(printf '%s' "${revision_json}" | jq -r '[.spec.containers[0].env[]? | select(.name == "PASSAGE_WRITES_DISABLED") | .value] | last // ""')"
  case "${writes_disabled}" in
    true)
      echo "production write fence is enabled" >&2
      exit 1
      ;;
    false|"")
      ;;
    *)
      echo "production write fence state is invalid" >&2
      exit 1
      ;;
  esac

  public_signup_enabled="$(printf '%s' "${revision_json}" | jq -r '[.spec.containers[0].env[]? | select(.name == "PASSAGE_PUBLIC_SIGNUP_ENABLED") | .value] | last // ""')"
  case "${public_signup_enabled}" in
    true)
      echo "public signup is already enabled" >&2
      exit 1
      ;;
    false|"")
      ;;
    *)
      echo "public signup state is invalid" >&2
      exit 1
      ;;
  esac
}

cleanup() {
  operation_status=$?
  trap - EXIT
  if ! gcloud run jobs delete "${job_name}" \
    --project="${GCP_PROJECT_ID}" \
    --region="${GCP_REGION}" \
    --quiet >/dev/null 2>&1; then
    echo "ephemeral production operation job cleanup failed" >&2
    if [[ "${operation_status}" -eq 0 ]]; then
      operation_status=1
    fi
  fi
  exit "${operation_status}"
}
trap cleanup EXIT

image_json="$(
  gcloud artifacts docker images describe "${IMAGE}" \
    --project="${GCP_PROJECT_ID}" \
    --format=json
)"
image_digest="$(printf '%s' "${image_json}" | jq -r '.image_summary.digest // ""')"
if [[ ! "${image_digest}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "exact image digest could not be resolved" >&2
  exit 1
fi
resolved_image="${IMAGE%:${COMMIT_SHA}}@${image_digest}"

load_serving_revision
expected_serving_revision="${serving_revision}"

gcloud run jobs deploy "${job_name}" \
  --project="${GCP_PROJECT_ID}" \
  --region="${GCP_REGION}" \
  --image="${resolved_image}" \
  --service-account="${CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT}" \
  --set-cloudsql-instances="${CLOUD_SQL_INSTANCE}" \
  --set-secrets="DATABASE_URL=${DATABASE_SECRET}:latest" \
  --set-env-vars="APP_ENV=production,PASSAGE_DATABASE_MAX_CONNS=1,PASSAGE_WRITES_DISABLED=${writes_disabled:-false}" \
  --args="${command_args_csv}" \
  --tasks=1 \
  --max-retries=0 \
  --task-timeout=2m \
  --labels="commit-sha=${COMMIT_SHA},github-run-id=${GITHUB_RUN_ID}" \
  --quiet

load_serving_revision
if [[ "${serving_revision}" != "${expected_serving_revision}" ]]; then
  echo "serving revision changed during production operation preparation" >&2
  exit 1
fi

gcloud run jobs execute "${job_name}" \
  --project="${GCP_PROJECT_ID}" \
  --region="${GCP_REGION}" \
  --wait \
  --quiet
