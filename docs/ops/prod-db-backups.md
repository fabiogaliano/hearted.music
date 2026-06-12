# Prod DB Backups

Production runs on the Supabase free plan — PITR is not available. Backups are daily logical dumps from the Bun worker via `pg_dump`, stored on a persistent Coolify mount.

- host path: `/opt/hearted-backups`
- container path: `/backups`
- dump format: PostgreSQL custom archive (`.dump`)
- **RPO:** ~24 hours
- **RTO:** ~30–90 minutes

## Worker Config

```env
BACKUP_ENABLED=true
BACKUP_DATABASE_URL=postgresql://...   # use direct or session pooler on port 5432, not transaction pooler on 6543
BACKUP_DIR=/backups
BACKUP_RETENTION_DAYS=7
BACKUP_SCHEDULE_HOUR_UTC=3
BACKUP_SCHEDULE_MINUTE_UTC=0
BACKUP_FILE_PREFIX=hearted
```

If `BACKUP_DATABASE_URL` is unset, the worker falls back to `DATABASE_URL`. The worker runs an immediate catch-up backup on boot when the latest scheduled slot was missed.

## Coolify Storage

Configure persistent storage on the worker resource:

- source: `/opt/hearted-backups`
- destination: `/backups`

The container runs as `bun` — fix host directory permissions if backup writes fail.

## Verify Backup Connection

Inside the worker container:

```bash
bun -e 'const u=new URL(process.env.BACKUP_DATABASE_URL ?? process.env.DATABASE_URL ?? ""); console.log({port:u.port||"5432", isPooler:u.hostname.includes("pooler"), kind:u.port==="6543"?"transaction-pooler":u.hostname.includes("pooler")?"session-pooler-or-other-pooler":"direct"})'
```

Healthy: `kind: "direct"` or `kind: "session-pooler-or-other-pooler"` with port `5432`.

## Restore

1. Pick the backup file from `/opt/hearted-backups` on the VPS
2. Provision a fresh PostgreSQL 17 target (preferred: new Supabase project)
3. Restore:

```bash
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname="$TARGET_DATABASE_URL" \
  /opt/hearted-backups/hearted-YYYY-MM-DD-HHMM.dump
```

4. Verify critical tables and row counts
5. Point production env vars at the new database
6. Redeploy app and worker
7. Smoke-test sign-in, queue processing, and one read/write path

## Limitations

Protects against accidental destructive migrations, bad data writes, and Supabase project loss.

Does **not** protect against:
- data loss between last dump and the incident
- VPS loss or compromise (backups are on the same VPS)
- point-in-time restore needs

Offsite replication is the next upgrade.
