import { describe, expect, it } from "vitest";
import { parseTelemetryRange } from "../telemetry-db";

describe("telemetry-db range parsing", () => {
	it("parses 24h preset into correct half-open boundaries", () => {
		const parsed = parseTelemetryRange("24h");
		expect(parsed.preset).toBe("24h");
		const durationMs = parsed.to.getTime() - parsed.from.getTime();
		expect(durationMs).toBe(24 * 3_600_000);
		expect(parsed.previousTo.getTime()).toBe(parsed.from.getTime());
		expect(parsed.previousTo.getTime() - parsed.previousFrom.getTime()).toBe(24 * 3_600_000);
	});

	it("parses 7d preset into correct boundaries", () => {
		const parsed = parseTelemetryRange("7d");
		expect(parsed.preset).toBe("7d");
		const durationMs = parsed.to.getTime() - parsed.from.getTime();
		expect(durationMs).toBe(7 * 86_400_000);
	});

	it("parses 30d preset as default", () => {
		const parsed = parseTelemetryRange("30d");
		expect(parsed.preset).toBe("30d");
		const durationMs = parsed.to.getTime() - parsed.from.getTime();
		expect(durationMs).toBe(30 * 86_400_000);
	});
});
