#!/usr/bin/env bash
set -euo pipefail

project_id="${GCP_PROJECT_ID:-passage-md-prod}"
operator_email="${OPERATOR_EMAIL:?Set OPERATOR_EMAIL to the production operator address}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
api_base="https://monitoring.googleapis.com/v3/projects/${project_id}"
dashboard_api_base="https://monitoring.googleapis.com/v1/projects/${project_id}"
access_token="$(gcloud auth print-access-token)"

api_get() {
  curl -fsS -H "Authorization: Bearer ${access_token}" "$1"
}

api_post() {
  curl -fsS -X POST \
    -H "Authorization: Bearer ${access_token}" \
    -H "Content-Type: application/json" \
    --data-binary "@$2" \
    "$1"
}

channel_json="$(api_get "${api_base}/notificationChannels")"
channel_name="$(jq -r --arg email "${operator_email}" '.notificationChannels[]? | select(.type == "email" and .labels.email_address == $email) | .name' <<<"${channel_json}" | head -n 1)"
if [[ -z "${channel_name}" ]]; then
  channel_name="$(gcloud alpha monitoring channels create \
    --project="${project_id}" \
    --display-name="Passage production operator" \
    --description="Primary operator email for passage.md production alerts" \
    --type=email \
    --channel-labels="email_address=${operator_email}" \
    --user-labels="environment=production,service=passage-md" \
    --format='value(name)')"
  channel_json="$(api_get "${api_base}/notificationChannels")"
fi

verification_status="$(jq -r --arg name "${channel_name}" '.notificationChannels[] | select(.name == $name) | .verificationStatus // "NOT_REQUIRED"' <<<"${channel_json}")"
if [[ "${verification_status}" == "UNVERIFIED" ]]; then
  echo "Notification channel ${channel_name} requires operator verification." >&2
  exit 1
fi

uptime_name="$(api_get "${api_base}/uptimeCheckConfigs" | jq -r '.uptimeCheckConfigs[]? | select(.displayName == "Passage production health") | .name' | head -n 1)"
if [[ -z "${uptime_name}" ]]; then
  api_post "${api_base}/uptimeCheckConfigs" "${script_dir}/uptime-check.json" | jq -r '"Created " + .name'
else
  echo "Found ${uptime_name}"
fi

existing_policies="$(api_get "${api_base}/alertPolicies")"
while IFS= read -r policy; do
  display_name="$(jq -r '.displayName' <<<"${policy}")"
  policy_name="$(jq -r --arg display_name "${display_name}" '.alertPolicies[]? | select(.displayName == $display_name) | .name' <<<"${existing_policies}" | head -n 1)"
  if [[ -n "${policy_name}" ]]; then
    echo "Found ${policy_name}"
    continue
  fi
  policy_file="$(mktemp)"
  jq --arg channel "${channel_name}" \
    '. + {
      combiner: "OR",
      enabled: true,
      notificationChannels: [$channel],
      alertStrategy: {
        autoClose: "1800s",
        notificationPrompts: ["OPENED", "CLOSED"]
      }
    }' <<<"${policy}" >"${policy_file}"
  api_post "${api_base}/alertPolicies" "${policy_file}" | jq -r '"Created " + .name'
  rm -f "${policy_file}"
done < <(jq -c '.[]' "${script_dir}/alert-policies.json")

dashboard_name="$(api_get "${dashboard_api_base}/dashboards" | jq -r '.dashboards[]? | select(.displayName == "Passage production") | .name' | head -n 1)"
if [[ -z "${dashboard_name}" ]]; then
  api_post "${dashboard_api_base}/dashboards" "${script_dir}/dashboard.json" | jq -r '"Created " + .name'
else
  echo "Found ${dashboard_name}"
fi

echo "Notification channel: ${channel_name} (${verification_status})"
