#!/usr/bin/env bash
set -euo pipefail

if [[ "${GITHUB_REF:-}" != "refs/heads/main" ]]; then
  echo "production diagnostics must run from main" >&2
  exit 1
fi

lookback_minutes="${LOOKBACK_MINUTES:-30}"
if [[ ! "${lookback_minutes}" =~ ^([1-9]|[1-9][0-9]|1[01][0-9]|120)$ ]]; then
  echo "LOOKBACK_MINUTES must be an integer from 1 to 120" >&2
  exit 1
fi

project_id="${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
filter='resource.type="cloud_run_revision" AND resource.labels.service_name="passage-md" AND severity>=ERROR AND jsonPayload.operation="create Stripe Checkout session"'

entries="$(
  gcloud logging read "${filter}" \
    --project="${project_id}" \
    --freshness="${lookback_minutes}m" \
    --limit=20 \
    --order=desc \
    --format=json
)"

if ! jq -e 'type == "array" and length > 0' >/dev/null <<<"${entries}"; then
  echo "no recent production Checkout creation errors found" >&2
  exit 1
fi

jq -c '
  def redact:
    gsub("\\S+@\\S+"; "[redacted-email]")
    | gsub("(sk|rk)_(live|test)_[A-Za-z0-9_]+"; "[redacted-stripe-key]")
    | gsub("whsec_[A-Za-z0-9_]+"; "[redacted-webhook-secret]")
    | gsub("\\b(acct|cus|cs|sub|price|prod|pi|in|ch|evt|pm|seti|si|src|card|tok)_[A-Za-z0-9_]+\\b"; "[redacted-stripe-id]")
    | gsub("\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b"; "[redacted-account-id]");

  .[]
  | {
      timestamp,
      severity,
      revision: .resource.labels.revision_name,
      operation: .jsonPayload.operation,
      error: ((.jsonPayload.error // "missing structured error") | tostring | redact),
      request_id: (.jsonPayload.request_id // "missing request id")
    }
' <<<"${entries}"
