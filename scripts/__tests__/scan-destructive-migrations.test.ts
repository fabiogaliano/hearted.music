import { describe, expect, it } from "vitest";
import {
	parsePendingMigrations,
	scanMigrationSql,
} from "../db/scan-destructive-migrations";

const blocked = (sql: string) =>
	scanMigrationSql(sql).filter((finding) => finding.allowedReason === null);

describe("scanMigrationSql", () => {
	it.each([
		["DROP TABLE", "DROP TABLE IF EXISTS public.old_thing;"],
		["DROP TABLE ... CASCADE", "DROP TABLE public.old_thing CASCADE;"],
		["DROP COLUMN", "ALTER TABLE song ADD COLUMN a int, DROP COLUMN isrc;"],
		["DROP COLUMN without the COLUMN keyword", "ALTER TABLE song DROP isrc;"],
		["DROP SCHEMA", "DROP SCHEMA legacy;"],
		["DROP VIEW nothing re-creates", "DROP VIEW public.liked_song_decorated;"],
		[
			"DROP FUNCTION nothing re-creates",
			"DROP FUNCTION IF EXISTS claim_job(uuid);",
		],
		["DROP TYPE ... CASCADE", "DROP TYPE job_status CASCADE;"],
		["table rename", "ALTER TABLE match_context RENAME TO match_snapshot;"],
		[
			"column rename",
			"ALTER TABLE playlist RENAME is_destination TO is_target;",
		],
		[
			"ALTER COLUMN ... TYPE",
			"ALTER TABLE t ALTER COLUMN embedding TYPE vector(512);",
		],
		[
			"ALTER COLUMN ... SET DATA TYPE",
			"ALTER TABLE t ALTER score SET DATA TYPE float8;",
		],
		["TRUNCATE", "TRUNCATE song_embedding;"],
		["DELETE without WHERE", "DELETE FROM song_embedding;"],
		[
			"CREATE INDEX CONCURRENTLY",
			"CREATE INDEX CONCURRENTLY idx ON song (name);",
		],
	])("flags %s", (_category, sql) => {
		expect(blocked(sql)).toHaveLength(1);
	});

	it("ignores destructive SQL in comments, so explaining a drop does not block the migration", () => {
		const sql = [
			"-- we considered it; DROP TABLE song would lose data, so we add a column",
			"/* keep; /* nested; */ TRUNCATE song; */",
			"ALTER TABLE song ADD COLUMN bio text;",
		].join("\n");
		expect(scanMigrationSql(sql)).toEqual([]);
	});

	it("ignores function bodies and string literals, which run only when called (a ';' inside them must not split statements)", () => {
		const sql = [
			"CREATE OR REPLACE FUNCTION purge(p uuid) RETURNS void AS $fn$",
			"BEGIN",
			"  PERFORM 1;",
			"  DELETE FROM job;",
			"  EXECUTE 'DROP TABLE ' || quote_ident('x');",
			"END $fn$ LANGUAGE plpgsql;",
			"COMMENT ON FUNCTION purge IS 'runs on demand; TRUNCATE song stays out of migrations';",
		].join("\n");
		expect(scanMigrationSql(sql)).toEqual([]);
	});

	it("allows a DROP FUNCTION re-created later in the file (signature change) but still flags it with CASCADE", () => {
		const recreated = [
			"DROP FUNCTION IF EXISTS public.get_page(uuid, text);",
			"CREATE FUNCTION get_page(p uuid) RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;",
		].join("\n");
		expect(scanMigrationSql(recreated)).toEqual([]);
		expect(blocked(recreated.replace(");", ") CASCADE;"))).toHaveLength(1);
	});

	it("flags ALTER TABLE ... DROP CONSTRAINT ... CASCADE, which also drops the foreign keys referencing it", () => {
		expect(
			blocked("ALTER TABLE account DROP CONSTRAINT account_pkey CASCADE;"),
		).toHaveLength(1);
		expect(
			blocked("ALTER TABLE account DROP CONSTRAINT account_handle_check;"),
		).toEqual([]);
	});

	it("flags an unscoped DELETE inside a data-modifying CTE, even when the outer query has a WHERE", () => {
		expect(
			blocked(
				"WITH removed AS (DELETE FROM song RETURNING *) SELECT count(*) FROM removed WHERE true;",
			),
		).toHaveLength(1);
		expect(
			blocked(
				"WITH removed AS (DELETE FROM song WHERE id IN (SELECT 1) RETURNING *) SELECT 1;",
			),
		).toEqual([]);
	});

	it("blocks a file whose quote never closes, since a lexer misread there would hide every statement after it", () => {
		const sql = "SELECT $body$ never closed;\nDROP TABLE song;";
		expect(blocked(sql)).toMatchObject([{ line: 1 }]);
	});

	it("reports the line the statement starts on, so the annotation lands on it", () => {
		const sql =
			"CREATE TABLE a (id int);\n\n-- why\nALTER TABLE a\n  DROP COLUMN id;";
		expect(scanMigrationSql(sql)).toMatchObject([{ line: 4 }]);
	});

	it("passes a statement carrying `migration-safety: allow <reason>`, on its own line or the line above", () => {
		const sql = [
			"DROP TABLE app_token; -- migration-safety: allow nothing reads it since #412",
			"-- migration-safety: allow column unused since the v2 reader shipped",
			"ALTER TABLE song DROP COLUMN isrc;",
			"TRUNCATE song;",
		].join("\n");
		// The trailing comment on line 1 must not leak onto the TRUNCATE either.
		expect(scanMigrationSql(sql)).toMatchObject([
			{ line: 1, allowedReason: "nothing reads it since #412" },
			{ line: 3, allowedReason: "column unused since the v2 reader shipped" },
			{ line: 4, allowedReason: null },
		]);
	});

	it("keeps blocking an allow comment with no reason, so the escape hatch always explains itself", () => {
		expect(
			blocked("DROP TABLE app_token; -- migration-safety: allow"),
		).toHaveLength(1);
	});
});

describe("parsePendingMigrations", () => {
	// Transcripts captured from supabase CLI 2.101.0 (the version CI pins).
	it("reads the files a dry run would push", () => {
		const transcript = [
			"DRY RUN: migrations will *not* be pushed to the database.",
			"Connecting to remote database...",
			"Would push these migrations:",
			" • 20991231000000_probe_one.sql",
			" • 20991231000001_probe_two.sql",
			"Finished supabase db push.",
		].join("\n");
		expect(parsePendingMigrations(transcript)).toEqual({
			kind: "pending",
			files: ["20991231000000_probe_one.sql", "20991231000001_probe_two.sql"],
		});
	});

	it("keeps reading past a stdout line interleaved into the list, so later pending files are not skipped", () => {
		const transcript = [
			"Would push these migrations:",
			" • 20991231000000_probe_one.sql",
			"Finished supabase db push.",
			" • 20991231000001_probe_drop.sql",
		].join("\n");
		expect(parsePendingMigrations(transcript)).toEqual({
			kind: "pending",
			files: ["20991231000000_probe_one.sql", "20991231000001_probe_drop.sql"],
		});
	});

	it("reads an up-to-date remote as nothing pending", () => {
		const transcript =
			"DRY RUN: migrations will *not* be pushed to the database.\nConnecting to remote database...\nRemote database is up to date.\n";
		expect(parsePendingMigrations(transcript)).toEqual({
			kind: "pending",
			files: [],
		});
	});

	it("refuses an unrecognized transcript instead of reading it as nothing pending (fail closed)", () => {
		expect(
			parsePendingMigrations("Connecting to remote database...\n"),
		).toMatchObject({ kind: "unrecognized" });
		expect(
			parsePendingMigrations(
				"Would push these migrations:\n - 20991231000000_x.sql\n",
			),
		).toMatchObject({ kind: "unrecognized" });
	});
});
