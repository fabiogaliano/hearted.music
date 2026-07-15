import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	completeRun,
	insertStartedRun,
} from "../local-store/action-runs";
import {
	getLocalStore,
	initLocalStore,
	resetLocalStoreForTests,
} from "../local-store/store";
import {
	historyExport,
	historyPage,
	historyRun,
	historySummary,
	parseHistoryFilter,
} from "../history-api";

describe("parseHistoryFilter", () => {
	it("parses supported params and drops invalid ones", () => {
		const filter = parseHistoryFilter(
			new URL(
				"https://panel.test/?action=grant-access&mode=commit&status=succeeded&target=%20ada%20&page=2&pageSize=25&from=2026-07-01T00:00:00.000Z",
			),
		);
		expect(filter).toEqual({
			actionType: "grant-access",
			mode: "commit",
			status: "succeeded",
			target: "ada",
			from: "2026-07-01T00:00:00.000Z",
			to: undefined,
			page: 2,
			pageSize: 25,
		});
	});

	it("normalizes invalid values to safe defaults", () => {
		const filter = parseHistoryFilter(
			new URL(
				"https://panel.test/?mode=sideways&status=nope&page=-4&pageSize=7&from=not-a-date",
			),
		);
		expect(filter.mode).toBeUndefined();
		expect(filter.status).toBeUndefined();
		expect(filter.from).toBeUndefined();
		expect(filter.page).toBe(1);
		expect(filter.pageSize).toBe(50);
	});
});

describe("history read API", () => {
	let dir: string;

	beforeEach(async () => {
		dir = mkdtempSync(join(tmpdir(), "cp-history-"));
		await initLocalStore(join(dir, "history.sqlite"));
		const db = getLocalStore();
		insertStartedRun(db, {
			id: "run-1",
			prodRef: "test-ref",
			actionType: "grant-access",
			mode: "commit",
			targetType: "account",
			targetId: "acct-1",
			targetLabel: "Ada",
			inputSummary: { grantType: "songs" },
			startedAt: "2026-07-15T10:00:00.000Z",
			parentRunId: null,
		});
		completeRun(db, "run-1", {
			status: "succeeded",
			resultSummary: { status: "applied" },
			externalId: null,
			errorMessage: null,
			completedAt: "2026-07-15T10:00:01.000Z",
		});
		insertStartedRun(db, {
			id: "run-2",
			prodRef: "test-ref",
			actionType: "email-send",
			mode: "commit",
			targetType: "email",
			targetId: "a@b.test",
			targetLabel: "Subject",
			inputSummary: null,
			startedAt: "2026-07-15T11:00:00.000Z",
			parentRunId: null,
		});
	});

	afterEach(() => {
		resetLocalStoreForTests();
		rmSync(dir, { recursive: true, force: true });
	});

	it("returns a newest-first page result", () => {
		const page = historyPage(new URL("https://panel.test/?pageSize=25"));
		expect(page.total).toBe(2);
		expect(page.pageSize).toBe(25);
		expect(page.rows.map((r) => r.id)).toEqual(["run-2", "run-1"]);
	});

	it("filters by action type", () => {
		const page = historyPage(
			new URL("https://panel.test/?action=grant-access"),
		);
		expect(page.rows.map((r) => r.id)).toEqual(["run-1"]);
	});

	it("fetches a single run and null for a miss", () => {
		expect(historyRun("run-1")?.actionType).toBe("grant-access");
		expect(historyRun("missing")).toBeNull();
	});

	it("summarizes today's counts", () => {
		// Seed with the real clock so the "since start of today" window is stable
		// regardless of the machine date the suite runs on.
		insertStartedRun(getLocalStore(), {
			id: "run-today",
			prodRef: "test-ref",
			actionType: "release-year-set",
			mode: "dry_run",
			targetType: "song",
			targetId: "song-1",
			targetLabel: null,
			inputSummary: null,
			startedAt: new Date().toISOString(),
			parentRunId: null,
		});
		const summary = historySummary();
		expect(summary.dryRuns).toBeGreaterThanOrEqual(1);
	});

	it("exports all matching rows ignoring pagination", () => {
		const rows = historyExport(new URL("https://panel.test/?pageSize=1"));
		expect(rows).toHaveLength(2);
	});
});
