/**
 * Numbered, idempotent local-store migrations.
 *
 * Applied on server startup. A `schema_migration` ledger records which versions
 * have run so re-running is a no-op; each pending migration runs inside its own
 * transaction so a partial failure never leaves the ledger ahead of the schema.
 * This is a local, single-operator recall/recovery store — not product data —
 * so migrations only ever move forward and there is no down-migration path.
 */

import type { SqliteDriver } from "./sqlite";

interface Migration {
	version: number;
	up: string;
}

const MIGRATIONS: readonly Migration[] = [
	{
		version: 1,
		up: `
			create table action_run (
				id text primary key,
				prod_ref text not null,
				action_type text not null,
				mode text not null,
				target_type text,
				target_id text,
				target_label text,
				input_summary_json text,
				status text not null,
				result_summary_json text,
				error_message text,
				external_id text,
				started_at text not null,
				completed_at text,
				parent_run_id text
			);
			create index action_run_started_at_idx on action_run (started_at desc);
			create index action_run_action_type_idx on action_run (action_type);
			create index action_run_status_idx on action_run (status);
			create index action_run_mode_idx on action_run (mode);
		`,
	},
	{
		version: 2,
		up: `
			create table operation_preview (
				id text primary key,
				prod_ref text not null,
				action_type text not null,
				target_id text,
				input_hash text not null,
				state_fingerprint text not null,
				preview_json text not null,
				created_at text not null,
				expires_at text not null
			);
			create index operation_preview_expires_at_idx on operation_preview (expires_at);
		`,
	},
	{
		version: 3,
		up: `
			create table batch_run (
				id text primary key,
				prod_ref text not null,
				action_type text not null,
				status text not null,
				filter_json text,
				input_json text,
				input_hash text not null,
				total integer not null default 0,
				succeeded integer not null default 0,
				failed integer not null default 0,
				skipped integer not null default 0,
				cancelled integer not null default 0,
				concurrency integer not null,
				created_at text not null,
				committed_at text,
				completed_at text,
				parent_run_id text
			);
			create index batch_run_status_idx on batch_run (status);
			create index batch_run_created_at_idx on batch_run (created_at desc);

			create table batch_target (
				batch_id text not null,
				ordinal integer not null,
				target_type text not null,
				target_id text not null,
				target_label text,
				status text not null,
				skip_reason text,
				attempts integer not null default 0,
				result_json text,
				error_message text,
				external_id text,
				primary key (batch_id, ordinal)
			);
			create index batch_target_batch_status_idx on batch_target (batch_id, status);
		`,
	},
];

export function applyMigrations(db: SqliteDriver): void {
	db.exec(
		`create table if not exists schema_migration (
			version integer primary key,
			applied_at text not null
		)`,
	);
	const applied = new Set(
		db
			.all<{ version: number }>("select version from schema_migration")
			.map((row) => Number(row.version)),
	);
	for (const migration of MIGRATIONS) {
		if (applied.has(migration.version)) continue;
		db.exec("begin");
		try {
			db.exec(migration.up);
			db.run(
				"insert into schema_migration (version, applied_at) values (?, ?)",
				[migration.version, new Date().toISOString()],
			);
			db.exec("commit");
		} catch (error) {
			db.exec("rollback");
			throw error;
		}
	}
}
