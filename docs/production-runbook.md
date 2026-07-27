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

List recent backups and require a `SUCCESSFUL` automated backup:

```sh
gcloud sql backups list \
  --instance=passage-md-postgres \
  --project=passage-md-prod \
  --format='table(id,type,status,startTime,endTime,location,description)'
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
2. Keep production deletion protection enabled.
3. Record the incident time in UTC and choose a recovery timestamp before the damaging change.
4. Resolve the production project, instance, region, database version, edition, tier, storage size, storage type, and backup or recovery timestamp.
5. For an incident recovery that can lead to cutover, stop all application writes and record the last accepted write boundary before choosing the final recovery point.
6. Keep writes stopped through restore verification and cutover validation.
7. Identify any legitimate writes after the chosen recovery point so they can be reconciled before writes reopen.
8. Confirm the chosen temporary instance name does not exist.

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

Run the Cloud SQL safeguard and backup checks against `RECOVERY_INSTANCE`.

Do not shift traffic or reopen writes until every required setting is enabled and a `SUCCESSFUL` automated backup exists.

Passage applies its embedded database migrations every time the server starts.

For recovery from a bad migration, resolve a known-good image digest built before that migration and verify that its embedded migration set does not contain the bad migration.

Do not start the recovered database with the bad image or an unverified `latest` image.

Create a separately reviewed plan to update the application database secret to the verified recovery instance, deploy a compatible Cloud Run revision from the resolved image digest, and test before shifting normal traffic.

Record the database boundary and recovery instance used by each Cloud Run revision.

Reopen writes only after the recovered database, application revision, and reconciled data have passed validation.

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
