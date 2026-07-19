import { describe, expect, it } from "vitest";
import {
	classifyDatabaseConnection,
	createDatabaseBackupConfig,
	getLatestScheduledSlotAtOrBefore,
	isDatabaseUnreachable,
	msUntilNextScheduledBackup,
	shouldRunStartupCatchUp,
} from "../db-backup";

describe("db backup config", () => {
	it("stays disabled by default", () => {
		const result = createDatabaseBackupConfig({});
		expect(result).toEqual({ kind: "disabled" });
	});

	it("rejects the transaction pooler", () => {
		const result = createDatabaseBackupConfig({
			BACKUP_ENABLED: "true",
			BACKUP_DATABASE_URL:
				"postgresql://postgres.example:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require",
		});

		expect(result).toEqual({
			kind: "invalid",
			issue: {
				code: "transaction-pooler-unsupported",
				message:
					"pg_dump needs a stable session. Use a direct connection or Supabase session pooler on port 5432, never the transaction pooler on 6543.",
			},
		});
	});

	it("falls back to DATABASE_URL and keeps direct 5432 connections valid", () => {
		const result = createDatabaseBackupConfig({
			BACKUP_ENABLED: "true",
			DATABASE_URL:
				"postgresql://postgres.example:secret@db.project.supabase.co:5432/postgres?sslmode=require",
		});

		expect(result.kind).toBe("enabled");
		if (result.kind !== "enabled") return;
		expect(result.config.connection.kind).toBe("direct");
		expect(result.config.connection.host).toBe("db.project.supabase.co");
		expect(result.config.connection.port).toBe("5432");
		expect(result.config.directory).toBe("/backups");
		expect(result.config.minRetentionDays).toBe(7);
	});
});

describe("db backup scheduling", () => {
	const schedule = { hourUtc: 3, minuteUtc: 0 };

	it("classifies direct and session-pooler hosts correctly", () => {
		expect(
			classifyDatabaseConnection(
				new URL(
					"postgresql://postgres.example:secret@db.project.supabase.co:5432/postgres?sslmode=require",
				),
			),
		).toBe("direct");
		expect(
			classifyDatabaseConnection(
				new URL(
					"postgresql://postgres.example:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require",
				),
			),
		).toBe("session-pooler");
	});

	it("finds the latest scheduled slot before the current time", () => {
		const now = new Date(Date.UTC(2026, 4, 26, 1, 30, 0));
		expect(getLatestScheduledSlotAtOrBefore(now, schedule).toISOString()).toBe(
			"2026-05-25T03:00:00.000Z",
		);
	});

	it("computes the next scheduled delay in UTC", () => {
		const now = new Date(Date.UTC(2026, 4, 26, 2, 45, 0));
		expect(msUntilNextScheduledBackup(now, schedule)).toBe(15 * 60 * 1000);
	});

	it("runs catch-up when the latest scheduled slot has no newer backup", () => {
		const now = new Date(Date.UTC(2026, 4, 26, 6, 0, 0));
		expect(shouldRunStartupCatchUp(null, now, schedule)).toBe(true);
		expect(
			shouldRunStartupCatchUp(Date.UTC(2026, 4, 26, 2, 59, 59), now, schedule),
		).toBe(true);
		expect(
			shouldRunStartupCatchUp(Date.UTC(2026, 4, 26, 3, 0, 1), now, schedule),
		).toBe(false);
	});
});

describe("db backup unreachable-database classification", () => {
	// Verbatim from the production failure: the worker booted before Postgres
	// was accepting connections and the catch-up backup was lost.
	it("recognises the observed startup connection failure", () => {
		expect(
			isDatabaseUnreachable(
				'pg_dump: error: connection to server at "supabase.hearted.music" ' +
					"(57.129.63.224), port 5432 failed: server closed the connection " +
					"unexpectedly\n\tThis probably means the server terminated abnormally",
			),
		).toBe(true);
	});

	it.each([
		"pg_dump: error: could not connect to server",
		"pg_dump: error: connection failed: Connection refused",
		'pg_dump: error: could not translate host name "db" to address',
		"pg_dump: error: the database system is starting up",
	])("treats %s as unreachable", (stderr) => {
		expect(isDatabaseUnreachable(stderr)).toBe(true);
	});

	// These fail identically on every attempt, so retrying only delays the report.
	it.each([
		"pg_dump: error: permission denied for table song",
		"pg_dump: error: server version 17.2; pg_dump version 15.1",
		"pg_dump: error: no matching tables were found",
	])("treats %s as permanent", (stderr) => {
		expect(isDatabaseUnreachable(stderr)).toBe(false);
	});

	it("treats missing stderr as permanent", () => {
		expect(isDatabaseUnreachable(undefined)).toBe(false);
		expect(isDatabaseUnreachable("")).toBe(false);
	});
});
