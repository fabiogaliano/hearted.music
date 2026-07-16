import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ prodRef: () => "test-ref" }));

import {
	completeRun,
	getActionRun,
	insertStartedRun,
	listActionRuns,
	listActionRunsForExport,
	markStaleStartedInterrupted,
	summarizeToday,
} from "../local-store/action-runs";
import { applyMigrations } from "../local-store/migrations";
import {
	deletePreview,
	getValidPreview,
	insertPreview,
	PREVIEW_TTL_MS,
	prunePreviews,
	type StoredPreview,
} from "../local-store/operation-previews";
import { recordAction, redactText } from "../local-store/record";
import { openSqlite, type SqliteDriver } from "../local-store/sqlite";
import {
	initLocalStore,
	isLocalStoreReady,
	getLocalStore,
	resetLocalStoreForTests,
} from "../local-store/store";

describe("migrations", () => {
	it("creates the action_run table and is idempotent", async () => {
		const db = await openSqlite(":memory:");
		applyMigrations(db);
		applyMigrations(db);
		const versions = db.all<{ version: number }>(
			"select version from schema_migration order by version",
		);
		expect(versions.map((v) => Number(v.version))).toEqual([1, 2, 3, 4]);
		// All tables exist and are queryable.
		expect(db.all("select * from action_run")).toEqual([]);
		expect(db.all("select * from operation_preview")).toEqual([]);
		expect(db.all("select * from batch_run")).toEqual([]);
		expect(db.all("select * from batch_target")).toEqual([]);
		expect(db.all("select * from release_year_candidate")).toEqual([]);
		db.close();
	});
});

describe("operation_preview repository", () => {
	let db: SqliteDriver;

	beforeEach(async () => {
		db = await openSqlite(":memory:");
		applyMigrations(db);
	});

	afterEach(() => db.close());

	function seed(id: string, overrides: Partial<StoredPreview> = {}): StoredPreview {
		const created = "2026-07-15T10:00:00.000Z";
		const row: StoredPreview = {
			id,
			prodRef: "test-ref",
			actionType: "grant-access",
			targetId: `acct-${id}`,
			inputHash: `input-${id}`,
			stateFingerprint: `state-${id}`,
			previewJson: JSON.stringify({ willChange: true }),
			createdAt: created,
			expiresAt: new Date(Date.parse(created) + PREVIEW_TTL_MS).toISOString(),
			...overrides,
		};
		insertPreview(db, row);
		return row;
	}

	it("returns a preview that has not yet expired", () => {
		seed("1");
		const found = getValidPreview(db, "1", "2026-07-15T10:02:00.000Z");
		expect(found?.inputHash).toBe("input-1");
		expect(found?.stateFingerprint).toBe("state-1");
	});

	it("does not return an expired preview", () => {
		seed("1");
		const found = getValidPreview(db, "1", "2026-07-15T10:06:00.000Z");
		expect(found).toBeNull();
	});

	it("deletes a consumed preview", () => {
		seed("1");
		deletePreview(db, "1");
		expect(getValidPreview(db, "1", "2026-07-15T10:02:00.000Z")).toBeNull();
	});

	it("prunes only expired rows", () => {
		seed("1");
		seed("2", {
			expiresAt: "2026-07-15T09:00:00.000Z",
		});
		const removed = prunePreviews(db, "2026-07-15T10:00:00.000Z");
		expect(removed).toBe(1);
		expect(getValidPreview(db, "1", "2026-07-15T10:02:00.000Z")).not.toBeNull();
		expect(getValidPreview(db, "2", "2026-07-15T08:00:00.000Z")).toBeNull();
	});
});

describe("action_run repository", () => {
	let db: SqliteDriver;

	beforeEach(async () => {
		db = await openSqlite(":memory:");
		applyMigrations(db);
	});

	afterEach(() => db.close());

	function seedStarted(id: string, overrides: Record<string, unknown> = {}) {
		insertStartedRun(db, {
			id,
			prodRef: "test-ref",
			actionType: "grant-access",
			mode: "commit",
			targetType: "account",
			targetId: `acct-${id}`,
			targetLabel: "Ada Lovelace",
			inputSummary: { grantType: "songs", limit: 500 },
			startedAt: "2026-07-15T10:00:00.000Z",
			parentRunId: null,
			...overrides,
		});
	}

	it("records a started run then its success outcome", () => {
		seedStarted("1");
		completeRun(db, "1", {
			status: "succeeded",
			resultSummary: { status: "applied", newlyUnlocked: 12 },
			externalId: null,
			errorMessage: null,
			completedAt: "2026-07-15T10:00:02.000Z",
			targetLabel: "Ada Lovelace (resolved)",
		});
		const row = getActionRun(db, "1");
		expect(row?.status).toBe("succeeded");
		expect(row?.resultSummary).toEqual({ status: "applied", newlyUnlocked: 12 });
		expect(row?.inputSummary).toEqual({ grantType: "songs", limit: 500 });
		expect(row?.targetLabel).toBe("Ada Lovelace (resolved)");
		expect(row?.completedAt).toBe("2026-07-15T10:00:02.000Z");
	});

	it("does not wipe the pre-run label when the outcome omits one", () => {
		seedStarted("1");
		completeRun(db, "1", {
			status: "failed",
			resultSummary: null,
			externalId: null,
			errorMessage: "boom",
			completedAt: "2026-07-15T10:00:02.000Z",
		});
		expect(getActionRun(db, "1")?.targetLabel).toBe("Ada Lovelace");
		expect(getActionRun(db, "1")?.errorMessage).toBe("boom");
	});

	it("reclassifies stale started rows as interrupted", () => {
		seedStarted("1");
		seedStarted("2");
		completeRun(db, "2", {
			status: "succeeded",
			resultSummary: null,
			externalId: null,
			errorMessage: null,
			completedAt: "2026-07-15T10:00:02.000Z",
		});
		const changed = markStaleStartedInterrupted(db, "2026-07-15T11:00:00.000Z");
		expect(changed).toBe(1);
		expect(getActionRun(db, "1")?.status).toBe("interrupted");
		expect(getActionRun(db, "2")?.status).toBe("succeeded");
	});

	it("filters and paginates newest-first", () => {
		seedStarted("1", {
			actionType: "email-send",
			mode: "commit",
			startedAt: "2026-07-15T09:00:00.000Z",
		});
		seedStarted("2", {
			actionType: "grant-access",
			mode: "dry_run",
			startedAt: "2026-07-15T10:00:00.000Z",
		});
		seedStarted("3", {
			actionType: "grant-access",
			mode: "commit",
			startedAt: "2026-07-15T11:00:00.000Z",
		});
		const all = listActionRuns(db, { page: 1, pageSize: 50 });
		expect(all.total).toBe(3);
		expect(all.rows.map((r) => r.id)).toEqual(["3", "2", "1"]);

		const grants = listActionRuns(db, {
			actionType: "grant-access",
			page: 1,
			pageSize: 50,
		});
		expect(grants.total).toBe(2);
		expect(grants.rows.map((r) => r.id)).toEqual(["3", "2"]);

		const dryRuns = listActionRuns(db, { mode: "dry_run", page: 1, pageSize: 50 });
		expect(dryRuns.rows.map((r) => r.id)).toEqual(["2"]);

		const targeted = listActionRuns(db, { target: "acct-1", page: 1, pageSize: 50 });
		expect(targeted.rows.map((r) => r.id)).toEqual(["1"]);

		const windowed = listActionRuns(db, {
			from: "2026-07-15T09:30:00.000Z",
			to: "2026-07-15T10:30:00.000Z",
			page: 1,
			pageSize: 50,
		});
		expect(windowed.rows.map((r) => r.id)).toEqual(["2"]);

		const pageTwo = listActionRuns(db, { page: 2, pageSize: 2 });
		expect(pageTwo.total).toBe(3);
		expect(pageTwo.rows.map((r) => r.id)).toEqual(["1"]);
	});

	it("summarizes today's counts by mode and failure", () => {
		seedStarted("1", { mode: "commit" });
		completeRun(db, "1", {
			status: "failed",
			resultSummary: null,
			externalId: null,
			errorMessage: "x",
			completedAt: "2026-07-15T10:00:02.000Z",
		});
		seedStarted("2", { mode: "dry_run" });
		seedStarted("3", { mode: "commit" });
		const summary = summarizeToday(db, "2026-07-15T00:00:00.000Z");
		expect(summary).toEqual({ commits: 2, dryRuns: 1, failedOrPartial: 1 });
	});

	it("caps export rows", () => {
		for (let i = 0; i < 5; i++) seedStarted(String(i));
		const rows = listActionRunsForExport(db, {}, 3);
		expect(rows).toHaveLength(3);
	});
});

describe("redactText", () => {
	it("stores length and a stable hash, never the text", () => {
		const a = redactText("hello world");
		const b = redactText("hello world");
		expect(a.length).toBe(11);
		expect(a.sha256).toBe(b.sha256);
		expect(a.sha256).not.toContain("hello");
		expect(redactText("different").sha256).not.toBe(a.sha256);
	});
});

describe("store lifecycle + recordAction", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "cp-store-"));
	});

	afterEach(() => {
		resetLocalStoreForTests();
		rmSync(dir, { recursive: true, force: true });
	});

	it("initializes, records a successful run, and reclaims interrupted rows on restart", async () => {
		const path = join(dir, "history.sqlite");
		await initLocalStore(path);
		expect(isLocalStoreReady()).toBe(true);

		const result = await recordAction({
			actionType: "release-year-set",
			mode: "commit",
			targetType: "song",
			targetId: "song-1",
			inputSummary: { year: 1999 },
			run: async () => ({ ok: true, releaseYear: 1999 }),
			summarize: (r) => ({ result: { releaseYear: r.releaseYear } }),
		});
		expect(result.releaseYear).toBe(1999);

		const runs = listActionRuns(getLocalStore(), { page: 1, pageSize: 50 });
		expect(runs.total).toBe(1);
		expect(runs.rows[0]?.status).toBe("succeeded");
		expect(runs.rows[0]?.resultSummary).toEqual({ releaseYear: 1999 });

		// Leave a dangling started row, then re-open the same file.
		insertStartedRun(getLocalStore(), {
			id: "dangling",
			prodRef: "test-ref",
			actionType: "email-send",
			mode: "commit",
			targetType: null,
			targetId: null,
			targetLabel: null,
			inputSummary: null,
			startedAt: "2026-07-15T10:00:00.000Z",
			parentRunId: null,
		});
		resetLocalStoreForTests();
		await initLocalStore(path);
		expect(getActionRun(getLocalStore(), "dangling")?.status).toBe(
			"interrupted",
		);
	});

	it("records a failed run and rethrows", async () => {
		await initLocalStore(join(dir, "history.sqlite"));
		await expect(
			recordAction({
				actionType: "audio-approve",
				mode: "commit",
				targetId: "review-1",
				run: async () => {
					throw new Error("prod rejected");
				},
			}),
		).rejects.toThrow("prod rejected");
		const runs = listActionRuns(getLocalStore(), { page: 1, pageSize: 50 });
		expect(runs.rows[0]?.status).toBe("failed");
		expect(runs.rows[0]?.errorMessage).toBe("prod rejected");
	});

	it("refuses to run and never calls prod when the store is unavailable", async () => {
		resetLocalStoreForTests();
		expect(isLocalStoreReady()).toBe(false);
		let called = false;
		await expect(
			recordAction({
				actionType: "grant-access",
				mode: "commit",
				run: async () => {
					called = true;
					return null;
				},
			}),
		).rejects.toThrow(/refusing to mutate production/);
		expect(called).toBe(false);
	});
});
