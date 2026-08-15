#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ci_workflow="${repo_dir}/.github/workflows/ci.yml"
failure_workflow="${repo_dir}/.github/workflows/deployment-failure.yml"

job_block() {
  local job_name="$1"
  awk -v job_name="${job_name}" '
    $0 == "  " job_name ":" { in_job = 1 }
    in_job && $0 ~ /^  [[:alnum:]_-]+:$/ && $0 != "  " job_name ":" { exit }
    in_job { print }
  ' "${ci_workflow}"
}

deployment_request_job="$(job_block deployment-request)"
container_job="$(job_block container)"
deploy_job="$(job_block deploy)"

[[ -n "${deployment_request_job}" ]]
[[ -n "${container_job}" ]]
[[ -n "${deploy_job}" ]]

grep -Fq "on:" "${ci_workflow}"
grep -Fq "  push:" "${ci_workflow}"
grep -Fq "  pull_request:" "${ci_workflow}"
grep -Fq "  workflow_dispatch:" "${ci_workflow}"
grep -Fq "      release_sha:" "${ci_workflow}"
[[ "$(grep -Fc "default: preserve" "${ci_workflow}")" -eq 1 ]]

grep -Fxq "    if: github.event_name == 'workflow_dispatch'" <<<"${deployment_request_job}"
grep -Fq 'RELEASE_SHA: ${{ inputs.release_sha }}' <<<"${deployment_request_job}"
grep -Fq '"${GITHUB_REF}" != "refs/heads/main"' <<<"${deployment_request_job}"
grep -Fq '"${RELEASE_SHA}" != "${GITHUB_SHA}"' <<<"${deployment_request_job}"
if grep -Eq "id-token: write|google-github-actions/auth|gcloud|docker push|deploy-production.sh" <<<"${deployment_request_job}"; then
  echo "the deployment request gate has production mutation authority" >&2
  exit 1
fi

grep -Fq "docker/build-push-action@" <<<"${container_job}"
grep -Fq "push: false" <<<"${container_job}"
grep -Fq "load: \${{ github.event_name == 'workflow_dispatch' }}" <<<"${container_job}"
grep -Fq "docker save" <<<"${container_job}"
grep -Fq "actions/upload-artifact@" <<<"${container_job}"
grep -Fq "name: passage-production-image-\${{ github.sha }}" <<<"${container_job}"
grep -Fq "persist-credentials: false" <<<"${container_job}"
if grep -Eq "id-token: write|google-github-actions/auth|google-github-actions/setup-gcloud|gcloud auth|docker push|deploy-production.sh|push: true" <<<"${container_job}"; then
  echo "the container proof job can authenticate, push, migrate, or deploy" >&2
  exit 1
fi

grep -Fxq "    if: github.event_name == 'workflow_dispatch'" <<<"${deploy_job}"
grep -Fq "needs: [web, server, deployment-request, container]" <<<"${deploy_job}"
grep -Fq "id-token: write" <<<"${deploy_job}"
grep -Fq "uses: actions/checkout@" <<<"${deploy_job}"
grep -Fq 'ref: ${{ github.sha }}' <<<"${deploy_job}"
grep -Fq "persist-credentials: false" <<<"${deploy_job}"
grep -Fq "name: passage-production-image-\${{ github.sha }}" <<<"${deploy_job}"
grep -Fq "uses: actions/download-artifact@" <<<"${deploy_job}"
grep -Fq "docker load" <<<"${deploy_job}"
grep -Fq "uses: google-github-actions/auth@" <<<"${deploy_job}"
grep -Fq "uses: google-github-actions/setup-gcloud@" <<<"${deploy_job}"
grep -Fq "gcloud sql backups list" <<<"${deploy_job}"
grep -Fq 'curl --fail-with-body --silent --show-error "${APP_BASE_URL}/api/health"' <<<"${deploy_job}"
line_number() {
  local pattern="$1"
  local match
  match="$(grep -nFm1 "${pattern}" <<<"${deploy_job}")"
  printf '%s\n' "${match%%:*}"
}

checkout_line="$(line_number "Check out the approved release")"
backup_line="$(line_number "gcloud sql backups list")"
service_line="$(line_number "gcloud run services describe")"
health_line="$(line_number 'curl --fail-with-body --silent --show-error')"
push_line="$(line_number 'docker push "${IMAGE}"')"
main_push_line="$(line_number 'docker push "${MAIN_IMAGE}"')"
deploy_line="$(line_number "run: scripts/deploy-production.sh")"
for readiness_line in "${backup_line}" "${service_line}" "${health_line}"; do
  [[ "${readiness_line}" -lt "${push_line}" ]]
  [[ "${readiness_line}" -lt "${main_push_line}" ]]
done
[[ "${checkout_line}" -lt "${deploy_line}" ]]

grep -Fq 'docker push "${IMAGE}"' <<<"${deploy_job}"
grep -Fq 'docker push "${MAIN_IMAGE}"' <<<"${deploy_job}"
grep -Fq "run: scripts/deploy-production.sh" <<<"${deploy_job}"
grep -Fq 'STRIPE_BILLING_MODE: ${{ inputs.stripe_billing_mode }}' <<<"${deploy_job}"
if grep -Eq "github.event_name == 'push'|docker/build-push-action" <<<"${deploy_job}"; then
  echo "the production job accepts push events or rebuilds the proven image" >&2
  exit 1
fi

if grep -Eq 'uses: [^[:space:]]+@v[0-9]+' <<<"${container_job}${deploy_job}"; then
  echo "the production image path uses a mutable action tag" >&2
  exit 1
fi
[[ "$(grep -Fc 'name: passage-production-image-${{ github.sha }}' "${ci_workflow}")" -eq 2 ]]
if grep -Eq "run-id:|github-token:" <<<"${deploy_job}"; then
  echo "the production image download can select an artifact from another run" >&2
  exit 1
fi


[[ "$(grep -Fc "push: false" "${ci_workflow}")" -eq 1 ]]
[[ "$(grep -Fc "docker push" "${ci_workflow}")" -eq 2 ]]
[[ "$(grep -Fc "run: scripts/deploy-production.sh" "${ci_workflow}")" -eq 1 ]]
[[ "$(grep -Fc "id-token: write" "${ci_workflow}")" -eq 1 ]]

grep -Fq "github.event.workflow_run.event == 'workflow_dispatch'" "${failure_workflow}"
if grep -Fq "github.event.workflow_run.event == 'push'" "${failure_workflow}"; then
  echo "push CI failures are still classified as production deployment failures" >&2
  exit 1
fi
