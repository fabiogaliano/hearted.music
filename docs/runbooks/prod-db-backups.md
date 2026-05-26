# Production DB Backups

## Current Strategy

Production runs on the Supabase free plan, so Point-in-Time Recovery is not available.
The fallback is a daily logical backup from the Bun worker using `pg_dump` and a persistent
Coolify mount:

- host path: `/opt/hearted-backups`
- container path: `/backups`
- dump format: PostgreSQL custom archive (`.dump`)
- scheduler: worker runtime
- storage class: VPS-local only

This is a real recovery path, but it is not PITR.

## Recovery Targets

- **RPO:** about 24 hours
- **RTO:** about 30 to 90 minutes, depending on restore target setup and DB size

## Runtime Configuration

Set these on the Coolify worker:

```env
BACKUP_ENABLED=true
# Recommended even when DATABASE_URL already works. Keep backup connectivity
# independent from future app traffic changes.
BACKUP_DATABASE_URL=postgresql://...
BACKUP_DIR=/backups
BACKUP_RETENTION_DAYS=7
BACKUP_SCHEDULE_HOUR_UTC=3
BACKUP_SCHEDULE_MINUTE_UTC=0
BACKUP_FILE_PREFIX=hearted
```

Notes:

- `BACKUP_DATABASE_URL` should use a direct connection or Supabase session pooler on port `5432`
- do not use the transaction pooler on `6543`
- if `BACKUP_DATABASE_URL` is unset, the worker falls back to `DATABASE_URL`
- the worker runs an immediate catch-up backup on boot when the latest scheduled slot was missed

## Coolify Storage

Configure persistent storage on the worker resource:

- source path: `/opt/hearted-backups`
- destination path: `/backups`

The worker container runs as `bun`, so the host directory must be writable from inside the container.
If backup writes fail, fix permissions on the VPS first.

## Backup Verification

Inside the worker container, confirm the backup connection is not the transaction pooler:

```bash
bun -e 'const u=new URL(process.env.BACKUP_DATABASE_URL ?? process.env.DATABASE_URL ?? ""); console.log({port:u.port||"5432", isPooler:u.hostname.includes("pooler"), kind:u.port==="6543"?"transaction-pooler":u.hostname.includes("pooler")?"session-pooler-or-other-pooler":"direct"})'
```

Healthy output for backups is one of:

- `kind: "direct"`
- `kind: "session-pooler-or-other-pooler"` with port `5432`

## Restore Runbook

1. Pick the backup file to restore from `/opt/hearted-backups` on the VPS.
2. Provision a fresh PostgreSQL 17 target.
   - preferred: a new Supabase project
   - acceptable: another PostgreSQL 17 instance for emergency recovery
3. Restore the dump:

```bash
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname="$TARGET_DATABASE_URL" \
  /opt/hearted-backups/hearted-YYYY-MM-DD-HHMM.dump
```

4. Verify critical tables and row counts.
5. Point production env vars at the new database.
6. Redeploy the app and worker.
7. Smoke-test sign-in, queue processing, and one read/write path.

## Operational Limits

This protects against:

- accidental destructive migrations
- bad data writes discovered after the fact
- Supabase project loss where a full restore is acceptable

This does not fully protect against:

- data loss between the last dump and the incident
- VPS loss or compromise, because backups are stored on the same VPS
- point-in-time restore needs

Offsite replication is the next upgrade after this baseline is stable.
