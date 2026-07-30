#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
temporary_dir="$(mktemp -d)"
trap 'rm -rf "${temporary_dir}"' EXIT

export GCP_PROJECT_ID="passage-test"
export GITHUB_REF="refs/heads/main"
export LOOKBACK_MINUTES="30"
export PASSAGE_GCLOUD_LOG="${temporary_dir}/gcloud.log"
export PATH="${script_dir}/testdata:${PATH}"

fail() {
  echo "assertion failed: $*" >&2
  exit 1
}

assert_contains() {
  [[ "$1" == *"$2"* ]] || fail "expected output to contain: $2"
}

assert_not_contains() {
  [[ "$1" != *"$2"* ]] || fail "expected output not to contain: $2"
}

assert_empty_file() {
  [[ ! -s "$1" ]] || fail "expected empty file: $1"
}

export PASSAGE_GCLOUD_LOGGING_RESPONSE='[
  {
    "timestamp": "2026-07-30T06:30:00Z",
    "severity": "ERROR",
    "resource": {"labels": {"revision_name": "passage-test-00001-test"}},
    "jsonPayload": {
      "operation": "create Stripe Checkout session",
      "error": "customer üser@example.com or user@localhost account 8a3f7a31-c707-419c-bd03-7eec14c3125e Stripe cus_123ABC used sk_live_secret and whsec_secret",
      "request_id": "request-123"
    },
    "httpRequest": {
      "requestUrl": "https://passage.test/api/v1/billing/checkout",
      "userAgent": "private-user-agent"
    }
  }
]'

output="$("${script_dir}/query-production-checkout-errors.sh")"
[[ "$(wc -l <"${PASSAGE_GCLOUD_LOG}" | tr -d ' ')" -eq 1 ]] || fail "expected one gcloud invocation"
query="$(<"${PASSAGE_GCLOUD_LOG}")"
assert_contains "${query}" 'logging read'
assert_contains "${query}" 'resource.type="cloud_run_revision"'
assert_contains "${query}" 'resource.labels.service_name="passage-md"'
assert_contains "${query}" 'severity>=ERROR'
assert_contains "${query}" 'jsonPayload.operation="create Stripe Checkout session"'
assert_contains "${query}" "--project=${GCP_PROJECT_ID}"
assert_contains "${query}" "--freshness=${LOOKBACK_MINUTES}m"
assert_contains "${query}" "--limit=20"
assert_contains "${output}" '"revision":"passage-test-00001-test"'
assert_contains "${output}" '"operation":"create Stripe Checkout session"'
assert_contains "${output}" '"error":"customer [redacted-email] or [redacted-email] account [redacted-account-id] Stripe [redacted-stripe-id] used [redacted-stripe-key] and [redacted-webhook-secret]"'
assert_contains "${output}" '"request_id":"request-123"'
assert_not_contains "${output}" "requestUrl"
assert_not_contains "${output}" "userAgent"
assert_not_contains "${output}" "üser@example.com"
assert_not_contains "${output}" "user@localhost"
assert_not_contains "${output}" "8a3f7a31-c707-419c-bd03-7eec14c3125e"
assert_not_contains "${output}" "cus_123ABC"
assert_not_contains "${output}" "sk_live_secret"
assert_not_contains "${output}" "whsec_secret"

: >"${PASSAGE_GCLOUD_LOG}"
export LOOKBACK_MINUTES="121"
if "${script_dir}/query-production-checkout-errors.sh"; then
  echo "diagnostics accepted an excessive lookback" >&2
  exit 1
fi
assert_empty_file "${PASSAGE_GCLOUD_LOG}"

export LOOKBACK_MINUTES="18446744073709551617"
if "${script_dir}/query-production-checkout-errors.sh"; then
  echo "diagnostics accepted an overflowing lookback" >&2
  exit 1
fi
assert_empty_file "${PASSAGE_GCLOUD_LOG}"

export LOOKBACK_MINUTES="30"
export GITHUB_REF="refs/heads/topic"
if "${script_dir}/query-production-checkout-errors.sh"; then
  echo "diagnostics ran outside main" >&2
  exit 1
fi
assert_empty_file "${PASSAGE_GCLOUD_LOG}"

export GITHUB_REF="refs/heads/main"
export PASSAGE_GCLOUD_LOGGING_RESPONSE='[]'
if "${script_dir}/query-production-checkout-errors.sh"; then
  echo "diagnostics accepted an empty result" >&2
  exit 1
fi
