#!/usr/bin/env bun
/**
 * seed-user-snapshot.ts — regenerate supabase/seeds/prod-snapshot.sql from PROD.
 *
 * Snapshots ONE account's full listening data (songs + all the expensive
 * LLM/embedding/enrichment derivatives + library + playlists + auth identity)
 * into an idempotent SQL file that `supabase db reset` loads into local, so
 * local mirrors prod without re-running any paid computation.
 *
 * Read-only against prod. Reuses the same PROD_DATABASE_URL resolution as
 * scripts/db/prod.ts (.env.cloud.local → .env.cloud → .env).
 *
 *   bun run scripts/db/seed-user-snapshot.ts
 *
 * The song set is `liked ∪ playlist songs` so playlist_song rows never dangle.
 * oauth tokens are nulled (they contain a live credential and better-auth
 * rewrites them on the first local login). Job/demo FKs that point at
 * un-snapshotted rows are nulled so the load stays self-consistent.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import postgres from "postgres";

const REPO_ROOT = process.cwd();
const OUT = resolve(REPO_ROOT, "supabase/seeds/prod-snapshot.sql");

const ACCOUNT_ID = "201339cf-b4a8-4bc6-af3d-22a8609429d4";
const USER_ID = "53sFhzMlDhlzqxHQfTySHZjpYdX0Y7ke";

function fail(message: string): never {
	console.error(`\n✗ ${message}\n`);
	process.exit(1);
}

/** File-first KEY=VALUE reader, mirrors scripts/db/prod.ts. */
function readEnvValue(key: string, files: string[]): string | undefined {
	for (const file of files) {
		const path = resolve(REPO_ROOT, file);
		if (!existsSync(path)) continue;
		for (const raw of readFileSync(path, "utf-8").split("\n")) {
			const line = raw.trim();
			if (!line || line.startsWith("#")) continue;
			const eq = line.indexOf("=");
			if (eq === -1) continue;
			if (line.slice(0, eq).trim() !== key) continue;
			let value = line.slice(eq + 1).trim();
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			return value;
		}
	}
	return undefined;
}

const ACC = `'${ACCOUNT_ID}'::uuid`;
const PLAYLISTS = `select id from public.playlist where account_id = ${ACC}`;
// Every song the account touches — liked OR in one of its playlists — so no
// playlist_song / liked_song row references a song we didn't snapshot.
const SONG_SET = `(
	select song_id from public.liked_song where account_id = ${ACC}
	union
	select song_id from public.playlist_song where playlist_id in (${PLAYLISTS})
)`;

type Spec = {
	table: string;
	where: string;
	/** Columns forced to NULL: live secrets, or FKs to un-snapshotted rows. */
	nullCols?: string[];
};

// Emitted (and therefore inserted) in this order: parents before children.
const SPECS: Spec[] = [
	{ table: "artist", where: `spotify_id in (select distinct unnest(artist_ids) from public.song where id in ${SONG_SET})` },
	{ table: "song", where: `id in ${SONG_SET}` },
	{ table: "song_analysis", where: `song_id in ${SONG_SET}` },
	{ table: "song_lyrics", where: `song_id in ${SONG_SET}` },
	{ table: "annotation_distillation", where: `content_hash in (select content_hash from public.song_lyrics where song_id in ${SONG_SET})` },
	{ table: "song_embedding", where: `song_id in ${SONG_SET}` },
	{ table: "song_audio_feature", where: `song_id in ${SONG_SET}` },
	{ table: "user", where: `id = '${USER_ID}'` },
	{
		table: "oauth_account",
		where: `user_id = '${USER_ID}'`,
		nullCols: [
			"access_token",
			"refresh_token",
			"id_token",
			"password",
			"access_token_expires_at",
			"refresh_token_expires_at",
		],
	},
	{ table: "account", where: `id = ${ACC}` },
	{ table: "user_preferences", where: `account_id = ${ACC}`, nullCols: ["demo_song_id"] },
	{
		table: "library_processing_state",
		where: `account_id = ${ACC}`,
		nullCols: ["enrichment_active_job_id", "match_snapshot_refresh_active_job_id"],
	},
	{ table: "account_song_unlock", where: `account_id = ${ACC}` },
	{ table: "account_liked_song_access_grant", where: `account_id = ${ACC}` },
	{ table: "liked_song", where: `account_id = ${ACC}` },
	{ table: "playlist", where: `account_id = ${ACC}` },
	{ table: "playlist_song", where: `playlist_id in (${PLAYLISTS})` },
	{ table: "playlist_analysis", where: `playlist_id in (${PLAYLISTS})` },
	{ table: "playlist_profile", where: `playlist_id in (${PLAYLISTS})` },
];

/** SQL literal from a text value (every column is selected ::text). */
function lit(value: string | null): string {
	if (value === null) return "NULL";
	return `'${value.replace(/'/g, "''")}'`;
}

const dsn =
	readEnvValue("PROD_DATABASE_URL", [".env.cloud.local", ".env.cloud", ".env"]) ??
	process.env.PROD_DATABASE_URL;
if (!dsn) fail("PROD_DATABASE_URL not set (see .env.cloud.local / supabase-prod skill).");
if (dsn.includes("127.0.0.1") || dsn.includes("localhost")) {
	fail(`Refusing to snapshot a LOCAL url (${dsn}).`);
}

const sql = postgres(dsn, { prepare: false, max: 1, fetch_types: false, idle_timeout: 5 });

async function columnsOf(table: string): Promise<string[]> {
	const rows = await sql.unsafe(
		`select column_name from information_schema.columns
		 where table_schema = 'public' and table_name = $1
		 order by ordinal_position`,
		[table],
	);
	return rows.map((r) => r.column_name as string);
}

async function main() {
	const parts: string[] = [];
	parts.push(
		"-- GENERATED by scripts/db/seed-user-snapshot.ts — DO NOT EDIT BY HAND.",
		`-- Snapshot of account ${ACCOUNT_ID} (better-auth user ${USER_ID}) from prod.`,
		"-- Regenerate: bun run scripts/db/seed-user-snapshot.ts",
		"--",
		"-- session_replication_role=replica disables triggers + FK checks for a",
		"-- faithful, order-independent load; UNIQUE/PK conflicts still apply so the",
		"-- ON CONFLICT DO NOTHING clauses keep it idempotent across db resets.",
		"",
		"BEGIN;",
		"SET session_replication_role = replica;",
		"",
	);

	// Populated from the `song` spec; every later song-referencing row is
	// filtered to this set so a song deleted on prod mid-run (the SELECTs are
	// not one snapshot txn) can't leave a dangling song_id in local.
	const seededSongIds = new Set<string>();

	const summary: Record<string, number> = {};
	for (const spec of SPECS) {
		const cols = await columnsOf(spec.table);
		if (cols.length === 0) fail(`Table public.${spec.table} not found on prod.`);
		const selectList = cols.map((c) => `"${c}"::text as "${c}"`).join(", ");
		let rows = (await sql.unsafe(
			`select ${selectList} from public."${spec.table}" where ${spec.where}`,
		)) as unknown as Record<string, string | null>[];

		if (spec.table === "song") {
			for (const row of rows) if (row.id) seededSongIds.add(row.id);
		} else if (cols.includes("song_id")) {
			rows = rows.filter((r) => r.song_id !== null && seededSongIds.has(r.song_id));
		}

		summary[spec.table] = rows.length;
		const colList = cols.map((c) => `"${c}"`).join(", ");
		parts.push(`-- ${spec.table} (${rows.length} rows)`);
		for (const row of rows) {
			const values = cols
				.map((c) => (spec.nullCols?.includes(c) ? "NULL" : lit(row[c])))
				.join(", ");
			parts.push(
				`INSERT INTO public."${spec.table}" (${colList}) VALUES (${values}) ON CONFLICT DO NOTHING;`,
			);
		}
		parts.push("");
		console.error(`  ${spec.table.padEnd(32)} ${rows.length}`);
	}

	parts.push("SET session_replication_role = DEFAULT;", "COMMIT;", "");

	mkdirSync(dirname(OUT), { recursive: true });
	writeFileSync(OUT, parts.join("\n"), "utf-8");

	const bytes = Buffer.byteLength(parts.join("\n"));
	console.error(`\n✓ wrote ${OUT} (${(bytes / 1_048_576).toFixed(1)} MB)`);
	console.error(JSON.stringify(summary, null, 2));
}

try {
	await main();
} catch (error) {
	fail(error instanceof Error ? error.message : String(error));
} finally {
	await sql.end({ timeout: 5 });
}
