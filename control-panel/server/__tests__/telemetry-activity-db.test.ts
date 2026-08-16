import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../db", () => ({ read: mocks.read }));

import { getActivityMetrics, parseTelemetryRange } from "../telemetry-db";

describe("telemetry daily activity completeness", () => {
	beforeEach(() => {
		mocks.read
			.mockResolvedValueOnce([{ date: "2026-08-18", count: 2 }])
			.mockResolvedValueOnce([{ active_24h: 1, wau: 2, mau: 3 }])
			.mockResolvedValueOnce([]);
	});

	it("emits unavailable pre-migration dates, zero-count complete dates, and an incomplete current day", async () => {
		const range = parseTelemetryRange(
			"7d",
			new Date("2026-08-20T12:00:00.000Z"),
		);
		const report = await getActivityMetrics(range);
		const byDate = new Map(report.dailyActive.map((day) => [day.date, day]));

		expect(byDate.get("2026-08-16")).toEqual({
			date: "2026-08-16",
			count: null,
			isComplete: false,
		});
		expect(byDate.get("2026-08-17")).toEqual({
			date: "2026-08-17",
			count: 0,
			isComplete: true,
		});
		expect(byDate.get("2026-08-18")?.count).toBe(2);
		expect(byDate.get("2026-08-19")?.count).toBe(0);
		expect(byDate.get("2026-08-20")).toEqual({
			date: "2026-08-20",
			count: null,
			isComplete: false,
		});
	});
});
