# Replication & Backup

> On managed Postgres (Supabase, RDS, Cloud SQL) replication, PITR, and backups are provided by the platform — you configure retention, not `recovery.conf`. This is for self-managed clusters and for understanding the mechanics.

## Streaming (physical) replication

Byte-for-byte standby of the whole cluster via WAL shipping. Read replicas + HA.

```ini
# primary postgresql.conf
wal_level = replica
max_wal_senders = 10
max_replication_slots = 10
hot_standby = on
```
```sql
-- primary
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '…';
SELECT pg_create_physical_replication_slot('replica_1');   -- slot prevents needed WAL from being removed
```
```bash
# standby: clone from primary; -R writes standby.signal + primary_conninfo
pg_basebackup -h PRIMARY -D $PGDATA -U replicator -P -v -R -X stream -S replica_1
```

Monitor:
```sql
-- primary: lag per standby (bytes)
SELECT client_addr, state, sync_state,
       pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS lag_bytes
FROM pg_stat_replication;

-- standby: time lag
SELECT now() - pg_last_xact_replay_timestamp() AS replication_lag;

-- replication slots can pin WAL forever if a standby is gone — watch retained size
SELECT slot_name, active,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained
FROM pg_replication_slots;
```

Synchronous (zero data loss, higher latency): `synchronous_standby_names = 'FIRST 1 (replica_1, replica_2)'` + `synchronous_commit = on`.

Failover/HA: `SELECT pg_promote();` for manual; **Patroni** (+ etcd/consul) is the standard automated-HA stack.

## Logical replication (row-level, selective)

Replicate specific tables, across versions, into a different schema — for migrations, CDC, and selective sync.

```sql
-- publisher (wal_level = logical)
CREATE PUBLICATION pub FOR TABLE users, orders;          -- or FOR ALL TABLES
-- PG 15+: row filters & column lists
CREATE PUBLICATION active_users FOR TABLE users WHERE (active);

-- subscriber
CREATE SUBSCRIPTION sub
  CONNECTION 'host=PUB dbname=app user=replicator password=…'
  PUBLICATION pub;                                        -- WITH (copy_data=true) initial snapshot
SELECT * FROM pg_stat_subscription;
```

Limitation to plan around: logical replication carries **DML only** — it does **not** replicate DDL (schema changes) or sequence values. Apply schema changes to both sides yourself, and reset target sequences at cutover.

Modern improvements: **PG 16** can run logical replication *from a standby* (offload CDC) — but a slot created on a PG 16 standby is lost on promotion unless it's a PG 17 failover slot (next). **PG 17** adds failover slots (`failover=true` + `sync_replication_slots=on` survive primary failover) and **`pg_createsubscriber`** (turn a physical standby into a logical replica without a fresh dump). **PG 18** defaults `streaming = parallel` for higher apply throughput.

## Backups

| Method | Granularity | PITR | Use |
|---|---|---|---|
| **pg_dump** (logical) | per-DB / per-table, version-portable | no | dev refresh, migrations, selective restore |
| **pg_basebackup** (physical) | whole cluster | with WAL | standby seeding, full-cluster restore |
| **PITR** = base backup + archived WAL | whole cluster, any point in time | yes | production disaster recovery |

```bash
pg_dump -Fc -d app -f app.dump && pg_restore -d app app.dump      # logical, custom/compressed
pg_dump -Fd -j4 -d app -f app.dir                                  # parallel dump REQUIRES directory format (-Fd), not -Fc
pg_basebackup -h localhost -U postgres -D /backup/base -Ft -z -Xs -P   # physical, self-consistent (-Xs = --wal-method=stream)
```

**Incremental physical backups (PG 17+):** `pg_basebackup --incremental=/path/to/backup_manifest` captures only blocks changed since the referenced backup; reconstruct a full backup from the chain with `pg_combinebackup` before restore. Cuts backup size/time on large clusters — but a managed backup tool (below) still automates retention better than hand-rolling the chain.

PITR setup: `archive_mode = on`, `archive_command = '… copy %p to archive/%f'`; restore by setting `restore_command` + `recovery_target_time` and creating `recovery.signal`. Production tools — **pgBackRest**, **Barman**, **WAL-G** — handle incremental backups, retention, and parallel WAL archiving; use one rather than hand-rolling.

**The only rule that matters:** an untested backup is not a backup. Restore to a scratch instance on a schedule and verify the data. Track `recovery_target` capability against your RPO/RTO.
