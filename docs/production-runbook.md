# Production Runbook

## Scope

This runbook covers the initial single-region Passage deployment in `passage-md-prod`.

The production Cloud SQL instance is `passage-md-postgres` in `us-central1`.

Never restore a backup over the production instance.

Always restore to a separate temporary instance, verify it, and plan an explicit application cutover.

## Recovery Objectives

The initial recovery point objective is 24 hours for backup-only recovery and 5 minutes for point-in-time recovery after transaction logs are available.

The initial recovery time objective is 4 hours.

These objectives assume an operator has working Google Cloud access and Cloud SQL has regional capacity.

The database is zonal, so an instance or zone failure can cause downtime while Cloud SQL recovery completes.

Multi-region recovery and a regional high-availability primary are outside the initial launch scope.

## Cloud SQL Safeguards

The production instance must keep these settings:

- Automated backups enabled with a daily `20:00 UTC` backup window.
- Seven retained automated backups.
- Point-in-time recovery enabled.
- Seven days of PostgreSQL transaction logs, which is the Enterprise edition maximum.
- Cloud SQL deletion protection enabled.
- Storage auto-resize enabled.

Check the current settings before and after any database operation:

```sh
gcloud sql instances describe passage-md-postgres \
  --project=passage-md-prod \
  --format='yaml(
    name,
    project,
    region,
    gceZone,
    state,
    settings.tier,
    settings.edition,
    settings.availabilityType,
    settings.dataDiskSizeGb,
    settings.dataDiskType,
    settings.deletionProtectionEnabled,
    settings.storageAutoResize,
    settings.backupConfiguration.enabled,
    settings.backupConfiguration.startTime,
    settings.backupConfiguration.pointInTimeRecoveryEnabled,
    settings.backupConfiguration.transactionLogRetentionDays,
    settings.backupConfiguration.backupRetentionSettings
  )'
```

Cloud SQL v1beta4 and `gcloud sql instances describe` expose deletion protection as `settings.deletionProtectionEnabled`.

Do not continue unless the output includes this exact enabled value:

```yaml
settings:
  deletionProtectionEnabled: true
```

Require the newest `SUCCESSFUL` automated backup to be no more than 24 hours old:

```sh
latest_automated_backup="$(
  gcloud sql backups list \
    --instance=passage-md-postgres \
    --project=passage-md-prod \
    --filter='type=AUTOMATED AND status=SUCCESSFUL' \
    --sort-by='~endTime' \
    --limit=1 \
    --format=json
)"

if ! printf '%s\n' "$latest_automated_backup" | jq -e '
  if length != 1 then
    false
  else
    (.[0].endTime | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) as $end
    | now >= $end and (now - $end) <= 86400
  end
' >/dev/null; then
  echo 'No successful automated backup completed within the last 24 hours.' >&2
  exit 1
fi

printf '%s\n' "$latest_automated_backup" |
  jq -r '.[0] | {id, type, status, startTime, endTime, location, description}'
```

Check application and database health:

```sh
curl --fail-with-body --silent --show-error https://passage.md/api/health
```

## Cloud Run Rollback

Use this path when a deployment is bad but the database is healthy.

Do not restore the database to roll back application code.

1. Confirm `/api/health`, Cloud Run logs, and the current database state.
2. Resolve the service name, region, current revision, and known-good revision before changing traffic.
3. Route all traffic to the known-good revision.
4. Recheck `/api/health` and the affected user flow.
5. Record the failed revision, restored revision, reason, and verification in the incident or GitHub issue.

```sh
gcloud run services describe passage-md \
  --project=passage-md-prod \
  --region=us-central1

gcloud run revisions list \
  --service=passage-md \
  --project=passage-md-prod \
  --region=us-central1

gcloud run services update-traffic passage-md \
  --project=passage-md-prod \
  --region=us-central1 \
  --to-revisions=KNOWN_GOOD_REVISION=100
```

Replace `KNOWN_GOOD_REVISION` only after resolving it from the revision list.

## Database Recovery

Use point-in-time recovery for accidental writes or a bad migration when the required timestamp is inside the retained transaction-log window.

Use a successful automated backup when a backup boundary is sufficient or point-in-time recovery is unavailable.

Never target `passage-md-postgres` with a restore command.

### 1. Stabilize and resolve

1. Stop the source of damaging writes if writes are still occurring.
2. Pause normal application deployments and cancel any queued deployment before changing traffic.
3. Keep production deletion protection enabled.
4. Record the incident time in UTC and identify a candidate recovery timestamp before the damaging change.
5. Resolve the production project, instance, region, database version, edition, tier, storage size, storage type, and backup or recovery timestamp.
6. For an incident recovery that can lead to cutover, enable and verify the application write fence below.
7. Keep the fence enabled through restore verification and cutover validation.
8. Select the final recovery point only after the fenced revision has all traffic and every previously serving revision has drained.
9. Identify any legitimate writes after the chosen recovery point so they can be reconciled before writes reopen.
10. Confirm the chosen temporary instance name does not exist.

`PASSAGE_WRITES_DISABLED=true` makes the server reject every non-read HTTP method with `503 Service Unavailable`.

This includes browser and CLI document writes, auth and administration mutations, billing routes, and Stripe webhooks.

It also prevents startup migrations, disables the password-reset queue worker, and blocks the `migrate`, `user`, `account delete`, and `account cleanup-stripe` commands in that process.

Bearer-authenticated reads remain available without updating API-token usage timestamps.

`account export` remains available because it performs the required read-only database export.

Resolve every revision currently receiving traffic before enabling the fence:

```sh
project=passage-md-prod
region=us-central1
service=passage-md
base_url=https://passage.md

service_state="$(
  gcloud run services describe "$service" \
    --project="$project" \
    --region="$region" \
    --format=json
)"

previous_revisions="$(
  printf '%s\n' "$service_state" |
    jq -er '
      [.status.traffic[]? | select((.percent // 0) > 0) | .revisionName]
      | unique
      | if length > 0 then .[] else error("expected at least one traffic-bearing revision") end
    '
)"

test -n "$previous_revisions"
```

Create a fenced revision and direct all traffic to it:

```sh
gcloud run services update "$service" \
  --project="$project" \
  --region="$region" \
  --update-env-vars=PASSAGE_WRITES_DISABLED=true

gcloud run services update-traffic "$service" \
  --project="$project" \
  --region="$region" \
  --to-latest
```

Verify the exact deployed environment value, latest ready revision, and 100 percent traffic assignment with a fail-closed check:

```sh
service_state="$(
  gcloud run services describe "$service" \
    --project="$project" \
    --region="$region" \
    --format=json
)"

fenced_revision="$(
  printf '%s\n' "$service_state" |
    jq -er '.status.latestReadyRevisionName'
)"

if ! printf '%s\n' "$service_state" | jq -e \
  --arg revision "$fenced_revision" '
    any(
      .spec.template.spec.containers[0].env[]?;
      .name == "PASSAGE_WRITES_DISABLED" and .value == "true"
    )
    and any(
      .status.traffic[]?;
      .revisionName == $revision and .percent == 100
    )
  ' >/dev/null; then
  echo 'The write-fenced revision is not configured and serving 100 percent of traffic.' >&2
  exit 1
fi

if printf '%s\n' "$previous_revisions" | grep -Fxq "$fenced_revision"; then
  echo 'The fence did not create a new revision.' >&2
  exit 1
fi
```

Verify a read and a representative mutation through the production URL:

```sh
curl --fail --silent --show-error "$base_url/api/health" |
  jq -e '.status == "ok" and .database == "ok"'

write_status="$(
  curl --silent --show-error \
    --output /dev/null \
    --write-out '%{http_code}' \
    --request POST \
    --header 'Content-Type: application/json' \
    --data '{}' \
    "$base_url/api/v1/auth/login"
)"

test "$write_status" = "503"
```

The production Cloud Run request timeout is 300 seconds.

Wait at least 300 seconds after the traffic check so requests on the previous revisions finish before selecting and recording the final recovery point.

Then verify through Cloud Monitoring that every previous revision has no active or idle instances.

This also stops its password-reset worker when production uses instance-based CPU allocation.

Cloud Monitoring samples this metric every 60 seconds and can take up to 120 additional seconds to publish it.

Keep one fixed observation boundary and poll for up to six minutes so the visibility delay cannot move the target on each retry.

```sh
drain_observation_after="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
monitoring_deadline="$(( $(date +%s) + 360 ))"

while :; do
  monitoring_end="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  access_token="$(gcloud auth print-access-token)" || exit 1
  all_revisions_drained=true

  for previous_revision in $previous_revisions; do
    instance_filter='metric.type="run.googleapis.com/container/instance_count" AND resource.type="cloud_run_revision"'
    instance_filter="$instance_filter AND resource.labels.service_name=\"$service\""
    instance_filter="$instance_filter AND resource.labels.revision_name=\"$previous_revision\""

    if ! previous_revision_instances="$(
      curl --fail --silent --show-error --get \
        --header "Authorization: Bearer $access_token" \
        --data-urlencode "filter=$instance_filter" \
        --data-urlencode "interval.startTime=$drain_observation_after" \
        --data-urlencode "interval.endTime=$monitoring_end" \
        --data-urlencode 'view=FULL' \
        "https://monitoring.googleapis.com/v3/projects/$project/timeSeries"
    )"; then
      all_revisions_drained=false
      break
    fi

    if ! printf '%s\n' "$previous_revision_instances" | jq -e \
      --arg observed_after "$drain_observation_after" '
        .error == null
        and (
          [
            .timeSeries[]?
            | .points[0]?
            | select(.interval.endTime >= $observed_after)
            | .value.int64Value
            | tonumber
          ] as $counts
          | ($counts | length) > 0
          and all($counts[]; . == 0)
        )
      ' >/dev/null; then
      all_revisions_drained=false
      break
    fi
  done
  unset access_token

  if [ "$all_revisions_drained" = true ]; then
    break
  fi
  if [ "$(date +%s)" -ge "$monitoring_deadline" ]; then
    echo 'A previous revision did not produce a fresh zero-instance observation.' >&2
    exit 1
  fi
  sleep 30
done
```

Record the fence verification time and select the final recovery point only after this check passes.

Do not treat console maintenance banners, client-side controls, or a single disabled route as a write fence.

### 2. Restore to a temporary instance

For point-in-time recovery:

```sh
gcloud sql instances clone \
  passage-md-postgres \
  TEMPORARY_INSTANCE \
  --project=passage-md-prod \
  --point-in-time='RFC3339_UTC_TIMESTAMP'
```

For backup recovery, create a temporary instance from the settings resolved from production and restore the resolved backup ID into it.

The temporary target storage allocation must be at least as large as the source allocation recorded before the restore.

Normalize the described API storage type for the `gcloud` create flag.

Use `SSD` for `PD_SSD`, `HDD` for `PD_HDD`, and `HYPERDISK_BALANCED` for `HYPERDISK_BALANCED`.

```sh
gcloud sql instances create TEMPORARY_INSTANCE \
  --project=passage-md-prod \
  --database-version=RESOLVED_DATABASE_VERSION \
  --edition=RESOLVED_EDITION \
  --tier=RESOLVED_TIER \
  --region=us-central1 \
  --availability-type=zonal \
  --storage-size=RESOLVED_STORAGE_GB \
  --storage-type=RESOLVED_GCLOUD_STORAGE_TYPE \
  --storage-auto-increase \
  --no-backup \
  --deletion-protection

gcloud sql backups restore BACKUP_ID \
  --backup-instance=passage-md-postgres \
  --restore-instance=TEMPORARY_INSTANCE \
  --project=passage-md-prod
```

### 3. Verify without reading customer content

Connect to the temporary instance through the Cloud SQL Auth Proxy.

Run the checks in a read-only transaction against the `passage` database:

```sql
BEGIN TRANSACTION READ ONLY;

SELECT version
FROM schema_migrations
ORDER BY version;

SELECT count(*) AS user_count
FROM users;

SELECT count(*) AS document_count
FROM documents;

COMMIT;
```

Compare migration versions with `server/internal/migrations`.

Record only migration versions, aggregate counts, timestamps, operation IDs, and non-secret settings.

Do not query or record emails, tokens, document titles, document bodies, share IDs, or other customer content.

### 4. Cut over or clean up

For an incident cutover, keep the original production instance unchanged and deletion-protected.

Keep application writes stopped while reconciling any legitimate writes after the selected recovery point.

Enable the production safeguards on the recovery instance before it receives application traffic:

```sh
gcloud sql instances patch RECOVERY_INSTANCE \
  --project=passage-md-prod \
  --backup-start-time=20:00 \
  --retained-backups-count=7 \
  --enable-point-in-time-recovery \
  --retained-transaction-log-days=7 \
  --deletion-protection \
  --storage-auto-increase
```

Validate every required recovery-instance setting with a fail-closed check:

```sh
recovery_settings="$(
  gcloud sql instances describe RECOVERY_INSTANCE \
    --project=passage-md-prod \
    --format=json
)"

if ! printf '%s\n' "$recovery_settings" | jq -e '
  .state == "RUNNABLE"
  and .settings.backupConfiguration.enabled == true
  and .settings.backupConfiguration.startTime == "20:00"
  and (.settings.backupConfiguration.backupRetentionSettings.retainedBackups | tonumber) >= 7
  and .settings.backupConfiguration.pointInTimeRecoveryEnabled == true
  and (.settings.backupConfiguration.transactionLogRetentionDays | tonumber) == 7
  and .settings.deletionProtectionEnabled == true
  and .settings.storageAutoResize == true
' >/dev/null; then
  echo 'The recovery instance does not have every required safeguard enabled.' >&2
  exit 1
fi
```

Do not run the automated-backup freshness check against the recovery instance before creating its immediate checkpoint.

Create an immediate pre-cutover backup instead of waiting for the next daily backup window:

```sh
checkpoint_description="pre-cutover recovery checkpoint $(date -u +%Y-%m-%dT%H:%M:%SZ)"

gcloud sql backups create \
  --instance=RECOVERY_INSTANCE \
  --project=passage-md-prod \
  --description="$checkpoint_description"

checkpoint_backup="$(
  gcloud sql backups list \
    --instance=RECOVERY_INSTANCE \
    --project=passage-md-prod \
    --filter='type=ON_DEMAND' \
    --sort-by='~endTime' \
    --limit=1 \
    --format=json
)"

if ! printf '%s\n' "$checkpoint_backup" | jq -e \
  --arg description "$checkpoint_description" '
    length == 1
    and .[0].type == "ON_DEMAND"
    and .[0].status == "SUCCESSFUL"
    and .[0].description == $description
  ' >/dev/null; then
  echo 'The immediate pre-cutover backup did not complete successfully.' >&2
  exit 1
fi
```

Do not shift traffic or reopen writes until both fail-closed recovery settings and checkpoint checks pass.

Passage applies its embedded database migrations every time the server starts.

For recovery from a bad migration, resolve a known-good image digest built before that migration and verify that its embedded migration set does not contain the bad migration.

Do not start the recovered database with the bad image or an unverified `latest` image.

Create a separately reviewed plan to update the application database secret to the verified recovery instance, deploy a compatible Cloud Run revision from the resolved image digest, and test before shifting normal traffic.

Record the database boundary and recovery instance used by each Cloud Run revision.

Reopen writes only after the recovered database, application revision, and reconciled data have passed validation.

Before disabling the fence, reconcile legitimate post-boundary activity and confirm that Stripe has retained failed webhook deliveries for retry.

Disable the fence by deploying a new revision and sending all traffic to it:

```sh
gcloud run services update "$service" \
  --project="$project" \
  --region="$region" \
  --update-env-vars=PASSAGE_WRITES_DISABLED=false

gcloud run services update-traffic "$service" \
  --project="$project" \
  --region="$region" \
  --to-latest
```

Fail closed if the new revision does not have the explicit false value and 100 percent of traffic:

```sh
service_state="$(
  gcloud run services describe "$service" \
    --project="$project" \
    --region="$region" \
    --format=json
)"

write_revision="$(
  printf '%s\n' "$service_state" |
    jq -er '.status.latestReadyRevisionName'
)"

if ! printf '%s\n' "$service_state" | jq -e \
  --arg revision "$write_revision" '
    any(
      .spec.template.spec.containers[0].env[]?;
      .name == "PASSAGE_WRITES_DISABLED" and .value == "false"
    )
    and any(
      .status.traffic[]?;
      .revisionName == $revision and .percent == 100
    )
  ' >/dev/null; then
  echo 'The write-enabled revision is not configured and serving 100 percent of traffic.' >&2
  exit 1
fi
```

Recheck health, verify that the representative login request no longer returns the fence response, and monitor Stripe webhook delivery retries before closing the incident.

Routing back to the original database is safe only before writes reopen on the recovered database.

After writes reopen on the recovered database, do not route back to the original database unless an explicit reconciliation plan accounts for writes on both sides.

Rollback application code independently by routing to a compatible Cloud Run revision that uses the same active database.

For a drill with no cutover:

1. Stop the proxy.
2. Reconfirm the temporary instance name and production instance name.
3. Disable deletion protection only on the temporary instance.
4. Delete only the temporary instance.
5. Confirm the temporary instance is absent and production remains `RUNNABLE`.
6. Recheck `https://passage.md/api/health`.

```sh
gcloud sql instances patch TEMPORARY_INSTANCE \
  --project=passage-md-prod \
  --no-deletion-protection

gcloud sql instances delete TEMPORARY_INSTANCE \
  --project=passage-md-prod
```

## Evidence

For every recovery drill or incident, record:

- Production and temporary target names.
- Backup ID or point-in-time timestamp.
- Cloud SQL operation IDs and final statuses.
- Non-secret safeguard settings.
- Migration versions and aggregate user and document counts.
- Temporary-target deletion evidence.
- Final production health response.

Keep this evidence in the relevant GitHub issue or incident record.

Never paste database URLs, passwords, customer content, access tokens, cookies, or secret values.
