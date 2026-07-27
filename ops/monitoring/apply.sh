#!/usr/bin/env bash
set -euo pipefail

project_id="passage-md-prod"
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

api_patch() {
  curl -sS --fail-with-body -X PATCH \
    -H "Authorization: Bearer ${access_token}" \
    -H "Content-Type: application/json" \
    --data-binary "@$3" \
    "$1?updateMask=$2"
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
else
  gcloud alpha monitoring channels update "${channel_name}" \
    --project="${project_id}" \
    --display-name="Passage production operator" \
    --description="Primary operator email for passage.md production alerts" \
    --enabled \
    --update-user-labels="environment=production,service=passage-md" \
    --quiet >/dev/null
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
  uptime_file="$(mktemp)"
  jq --arg name "${uptime_name}" '. + {name: $name}' "${script_dir}/uptime-check.json" >"${uptime_file}"
  api_patch "https://monitoring.googleapis.com/v3/${uptime_name}" \
    "displayName,period,timeout,selectedRegions,httpCheck,contentMatchers" \
    "${uptime_file}" >/dev/null
  rm -f "${uptime_file}"
  echo "Updated ${uptime_name}"
fi

existing_policies="$(api_get "${api_base}/alertPolicies")"
while IFS= read -r policy; do
  display_name="$(jq -r '.displayName' <<<"${policy}")"
  policy_name="$(jq -r --arg display_name "${display_name}" '.alertPolicies[]? | select(.displayName == $display_name) | .name' <<<"${existing_policies}" | head -n 1)"
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
  if [[ -z "${policy_name}" ]]; then
    api_post "${api_base}/alertPolicies" "${policy_file}" | jq -r '"Created " + .name'
  else
    condition_name="$(jq -r --arg name "${policy_name}" '.alertPolicies[] | select(.name == $name) | .conditions[0].name' <<<"${existing_policies}")"
    updated_policy_file="$(mktemp)"
    jq --arg name "${policy_name}" --arg condition_name "${condition_name}" \
      '. + {name: $name} | .conditions[0].name = $condition_name' \
      "${policy_file}" >"${updated_policy_file}"
    api_patch "https://monitoring.googleapis.com/v3/${policy_name}" \
      "displayName,documentation,userLabels,conditions,combiner,enabled,notificationChannels,alertStrategy" \
      "${updated_policy_file}" >/dev/null
    rm -f "${updated_policy_file}"
    echo "Updated ${policy_name}"
  fi
  rm -f "${policy_file}"
done < <(jq -c '.[]' "${script_dir}/alert-policies.json")

dashboard_name="$(api_get "${dashboard_api_base}/dashboards" | jq -r '.dashboards[]? | select(.displayName == "Passage production") | .name' | head -n 1)"
if [[ -z "${dashboard_name}" ]]; then
  api_post "${dashboard_api_base}/dashboards" "${script_dir}/dashboard.json" | jq -r '"Created " + .name'
else
  dashboard_file="$(mktemp)"
  dashboard_etag="$(api_get "https://monitoring.googleapis.com/v1/${dashboard_name}" | jq -r '.etag')"
  jq --arg etag "${dashboard_etag}" '. + {etag: $etag}' "${script_dir}/dashboard.json" >"${dashboard_file}"
  gcloud monitoring dashboards update "${dashboard_name}" \
    --project="${project_id}" \
    --config-from-file="${dashboard_file}" \
    --quiet >/dev/null
  rm -f "${dashboard_file}"
  echo "Updated ${dashboard_name}"
fi

echo "Notification channel: ${channel_name} (${verification_status})"
