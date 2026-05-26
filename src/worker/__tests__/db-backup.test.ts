import { describe, expect, it } from "vitest";
import {
	classifyDatabaseConnection,
	createDatabaseBackupConfig,
	getLatestScheduledSlotAtOrBefore,
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
