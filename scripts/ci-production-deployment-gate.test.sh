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

container_job="$(job_block container)"
deploy_job="$(job_block deploy)"

[[ -n "${container_job}" ]]
[[ -n "${deploy_job}" ]]

grep -Fq "on:" "${ci_workflow}"
grep -Fq "  push:" "${ci_workflow}"
grep -Fq "  pull_request:" "${ci_workflow}"
grep -Fq "  workflow_dispatch:" "${ci_workflow}"
[[ "$(grep -Fc "default: preserve" "${ci_workflow}")" -eq 1 ]]

grep -Fq "uses: docker/build-push-action@v7" <<<"${container_job}"
grep -Fq "push: false" <<<"${container_job}"
if grep -Eq "id-token: write|google-github-actions/auth|google-github-actions/setup-gcloud|gcloud auth|deploy-production.sh|push: true" <<<"${container_job}"; then
  echo "the container proof job can authenticate, push, migrate, or deploy" >&2
  exit 1
fi

grep -Fxq "    if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'" <<<"${deploy_job}"
grep -Fq "needs: [web, server, container]" <<<"${deploy_job}"
grep -Fq "id-token: write" <<<"${deploy_job}"
grep -Fq "uses: google-github-actions/auth@v3" <<<"${deploy_job}"
grep -Fq "uses: google-github-actions/setup-gcloud@v3" <<<"${deploy_job}"
grep -Fq "push: true" <<<"${deploy_job}"
grep -Fq "run: scripts/deploy-production.sh" <<<"${deploy_job}"
grep -Fq 'STRIPE_BILLING_MODE: ${{ inputs.stripe_billing_mode }}' <<<"${deploy_job}"
if grep -Fq "github.event_name == 'push'" <<<"${deploy_job}"; then
  echo "the production deployment job accepts push events" >&2
  exit 1
fi

[[ "$(grep -Fc "push: true" "${ci_workflow}")" -eq 1 ]]
[[ "$(grep -Fc "run: scripts/deploy-production.sh" "${ci_workflow}")" -eq 1 ]]
[[ "$(grep -Fc "id-token: write" "${ci_workflow}")" -eq 1 ]]

grep -Fq "github.event.workflow_run.event == 'workflow_dispatch'" "${failure_workflow}"
if grep -Fq "github.event.workflow_run.event == 'push'" "${failure_workflow}"; then
  echo "push CI failures are still classified as production deployment failures" >&2
  exit 1
fi
