import { describe, expect, it } from "vitest";
import {
	calculatePercentile,
	parseTelemetryRange,
} from "../telemetry-db";
import { LAUNCH_DATE } from "../telemetry-registry";

describe("Telemetry Range & Percentile Contracts", () => {
	it("parses valid 24h preset to exact 24-hour UTC half-open interval", () => {
		const ref = new Date("2026-08-16T12:00:00.000Z");
		const r = parseTelemetryRange("24h", ref);

		expect(r.preset).toBe("24h");
		expect(r.to.toISOString()).toBe("2026-08-16T12:00:00.000Z");
		expect(r.from.toISOString()).toBe("2026-08-15T12:00:00.000Z");
		expect(r.previousTo.toISOString()).toBe("2026-08-15T12:00:00.000Z");
		expect(r.previousFrom.toISOString()).toBe("2026-08-14T12:00:00.000Z");

		// Durations must match exactly
		expect(r.to.getTime() - r.from.getTime()).toBe(24 * 3_600_000);
		expect(r.previousTo.getTime() - r.previousFrom.getTime()).toBe(
			24 * 3_600_000,
		);
	});

	it("parses valid 7d, 14d, 30d, 90d presets to exact duration intervals", () => {
		const ref = new Date("2026-08-16T12:00:00.000Z");

		const r7 = parseTelemetryRange("7d", ref);
		expect(r7.to.getTime() - r7.from.getTime()).toBe(7 * 86_400_000);
		expect(r7.previousTo.getTime() - r7.previousFrom.getTime()).toBe(
			7 * 86_400_000,
		);

		const r14 = parseTelemetryRange("14d", ref);
		expect(r14.to.getTime() - r14.from.getTime()).toBe(14 * 86_400_000);

		const r30 = parseTelemetryRange("30d", ref);
		expect(r30.to.getTime() - r30.from.getTime()).toBe(30 * 86_400_000);

		const r90 = parseTelemetryRange("90d", ref);
		expect(r90.to.getTime() - r90.from.getTime()).toBe(90 * 86_400_000);
	});

	it("uses the launch boundary inferred from the first production account date", () => {
		const ref = new Date("2026-08-16T12:00:00.000Z");
		const r = parseTelemetryRange("launch", ref);

		expect(r.from.toISOString()).toBe(LAUNCH_DATE);
		expect(r.previousTo.toISOString()).toBe(LAUNCH_DATE);
		expect(r.to.getTime() - r.from.getTime()).toBe(
			r.previousTo.getTime() - r.previousFrom.getTime(),
		);
	});

	it("uses deterministic five-minute report boundaries", () => {
		const first = parseTelemetryRange(
			"24h",
			new Date("2026-08-16T12:04:01.000Z"),
		);
		const second = parseTelemetryRange(
			"24h",
			new Date("2026-08-16T12:04:59.999Z"),
		);

		expect(first.toIso).toBe("2026-08-16T12:00:00.000Z");
		expect(second.toIso).toBe(first.toIso);
		expect(second.fromIso).toBe(first.fromIso);
	});

	it("rejects invalid presets with RangeError instead of falling back", () => {
		expect(() => parseTelemetryRange("invalid_range")).toThrow(RangeError);
		expect(() => parseTelemetryRange("all")).toThrow(RangeError);
		expect(() => parseTelemetryRange("5y")).toThrow(RangeError);
	});

	it("calculates percentiles mathematically accurately using linear rank interpolation", () => {
		// Empty array -> null
		expect(calculatePercentile([], 0.5)).toBeNull();

		// Single element
		expect(calculatePercentile([42], 0.5)).toBe(42);
		expect(calculatePercentile([42], 0.75)).toBe(42);

		// Odd length: [10, 20, 30]
		expect(calculatePercentile([10, 20, 30], 0.5)).toBe(20);
		expect(calculatePercentile([10, 20, 30], 0.75)).toBe(25);

		// Even length: [10, 20, 30, 40]
		expect(calculatePercentile([10, 20, 30, 40], 0.5)).toBe(25);
		expect(calculatePercentile([10, 20, 30, 40], 0.75)).toBe(32.5);

		// Boundary clamps
		expect(calculatePercentile([10, 20, 30], 0)).toBe(10);
		expect(calculatePercentile([10, 20, 30], 1)).toBe(30);
	});
});
