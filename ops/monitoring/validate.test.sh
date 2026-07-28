#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
alert_file="${script_dir}/alert-policies.json"
dashboard_file="${script_dir}/dashboard.json"
metric="cloudsql.googleapis.com/database/postgresql/num_backends"
database_id="passage-md-prod:passage-md-postgres"

jq empty "${alert_file}" "${dashboard_file}"

jq -e \
  --arg metric "${metric}" \
  --arg database_id "${database_id}" \
  '
    [.[] | select(.displayName == "Passage Cloud SQL connection pressure")] as $policies
    | ($policies | length) == 1
    and ($policies[0].conditions | length) == 1
    and ($policies[0].conditions[0].displayName == "Connections exceed 12 for 10 minutes")
    and ($policies[0].conditions[0].conditionThreshold as $condition
      | ($condition.filter | contains("metric.type = \"" + $metric + "\""))
      and ($condition.filter | contains("resource.label.database_id = \"" + $database_id + "\""))
      and ($condition.aggregations == [
        {
          "alignmentPeriod": "60s",
          "perSeriesAligner": "ALIGN_MAX",
          "crossSeriesReducer": "REDUCE_SUM"
        },
        {
          "alignmentPeriod": "300s",
          "perSeriesAligner": "ALIGN_MAX"
        }
      ])
      and ($condition.comparison == "COMPARISON_GT")
      and ($condition.thresholdValue == 12)
      and ($condition.duration == "600s"))
  ' "${alert_file}" >/dev/null

jq -e \
  --arg metric "${metric}" \
  --arg database_id "${database_id}" \
  '
    [.. | objects | select(.title? == "Cloud SQL connections")] as $widgets
    | ($widgets | length) == 1
    and ($widgets[0].xyChart.dataSets | length) == 1
    and ($widgets[0].xyChart.dataSets[0].timeSeriesQuery.timeSeriesFilter as $query
      | ($query.filter | contains("metric.type = \"" + $metric + "\""))
      and ($query.filter | contains("resource.label.database_id = \"" + $database_id + "\""))
      and ($query.aggregation == {
        "alignmentPeriod": "60s",
        "perSeriesAligner": "ALIGN_MAX",
        "crossSeriesReducer": "REDUCE_SUM"
      }))
    and ($widgets[0].xyChart.thresholds == [{"value": 12}])
  ' "${dashboard_file}" >/dev/null

if jq -se \
  --arg legacy_metric "cloudsql.googleapis.com/database/network/connections" \
  'any(.[]; tostring | contains($legacy_metric))' \
  "${alert_file}" "${dashboard_file}" >/dev/null; then
  echo "Monitoring configuration still references the non-emitted generic connection metric" >&2
  exit 1
fi

echo "Monitoring connection metric contract passed."
