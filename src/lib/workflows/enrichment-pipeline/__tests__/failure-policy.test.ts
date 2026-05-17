import { describe, expect, it } from "vitest";
import {
	applyFailurePolicy,
	BACKOFF_CODES,
	FAILURE_CODES,
} from "../failure-policy";

const FIXED_NOW = new Date("2026-04-26T12:00:00Z");

function minutesFromNow(ms: number): number {
	return Math.round(ms / 60000);
}

describe("applyFailurePolicy", () => {
	it("source_not_found suppresses for 30 days non-terminally", () => {
		const out = applyFailurePolicy({
			failureCode: FAILURE_CODES.SOURCE_NOT_FOUND,
			now: FIXED_NOW,
		});
		expect(out.isTerminal).toBe(false);
		expect(out.suppressUntil).not.toBeNull();
		const delta = (out.suppressUntil as Date).getTime() - FIXED_NOW.getTime();
		expect(minutesFromNow(delta)).toBe(30 * 24 * 60);
	});

	it("provider_unavailable suppresses for 6 hours non-terminally", () => {
		const out = applyFailurePolicy({
			failureCode: FAILURE_CODES.PROVIDER_UNAVAILABLE,
			now: FIXED_NOW,
		});
		expect(out.isTerminal).toBe(false);
		const delta = (out.suppressUntil as Date).getTime() - FIXED_NOW.getTime();
		expect(minutesFromNow(delta)).toBe(6 * 60);
	});

	it("provider_transient escalates exponentially from 15m", () => {
		const cases: { count: number; minutes: number }[] = [
			{ count: 0, minutes: 15 },
			{ count: 1, minutes: 30 },
			{ count: 2, minutes: 60 },
			{ count: 3, minutes: 120 },
			{ count: 4, minutes: 240 },
			{ count: 5, minutes: 480 },
			{ count: 6, minutes: 960 },
		];
		for (const { count, minutes } of cases) {
			const out = applyFailurePolicy({
				failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
				priorUnresolvedCount: count,
				now: FIXED_NOW,
			});
			expect(out.isTerminal).toBe(false);
			const delta = (out.suppressUntil as Date).getTime() - FIXED_NOW.getTime();
			expect(minutesFromNow(delta)).toBe(minutes);
		}
	});

	it("provider_transient caps at 24h regardless of escalation count", () => {
		const out = applyFailurePolicy({
			failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
			priorUnresolvedCount: 50,
			now: FIXED_NOW,
		});
		const delta = (out.suppressUntil as Date).getTime() - FIXED_NOW.getTime();
		expect(minutesFromNow(delta)).toBe(24 * 60);
	});

	it("analysis_postrun_lookup_unavailable shares the transient backoff curve", () => {
		const cases: { count: number; minutes: number }[] = [
			{ count: 0, minutes: 15 },
			{ count: 3, minutes: 120 },
			{ count: 6, minutes: 960 },
			{ count: 50, minutes: 24 * 60 },
		];
		for (const { count, minutes } of cases) {
			const out = applyFailurePolicy({
				failureCode: FAILURE_CODES.ANALYSIS_POSTRUN_LOOKUP_UNAVAILABLE,
				priorUnresolvedCount: count,
				now: FIXED_NOW,
			});
			expect(out.isTerminal).toBe(false);
			const delta = (out.suppressUntil as Date).getTime() - FIXED_NOW.getTime();
			expect(minutesFromNow(delta)).toBe(minutes);
		}
	});

	it("BACKOFF_CODES contains every code that the policy escalates by count", () => {
		// Guards the data-layer wrapper: any code that uses priorUnresolvedCount
		// inside applyFailurePolicy must also be in BACKOFF_CODES so the wrapper
		// queries for the count before calling the policy.
		expect(BACKOFF_CODES.has(FAILURE_CODES.PROVIDER_TRANSIENT)).toBe(true);
		expect(
			BACKOFF_CODES.has(FAILURE_CODES.ANALYSIS_POSTRUN_LOOKUP_UNAVAILABLE),
		).toBe(true);
	});

	it.each([
		FAILURE_CODES.ANALYSIS_BLOCKED_LYRICS_UNAVAILABLE,
		FAILURE_CODES.ANALYSIS_BLOCKED_AUDIO_UNAVAILABLE,
		FAILURE_CODES.ANALYSIS_BLOCKED_BOTH_UNAVAILABLE,
	])("%s suppresses 6h non-terminally", (code) => {
		const out = applyFailurePolicy({ failureCode: code, now: FIXED_NOW });
		expect(out.isTerminal).toBe(false);
		const delta = (out.suppressUntil as Date).getTime() - FIXED_NOW.getTime();
		expect(minutesFromNow(delta)).toBe(6 * 60);
	});

	it.each([
		FAILURE_CODES.ANALYSIS_INPUTS_MISSING,
		FAILURE_CODES.PERMANENT,
		FAILURE_CODES.VALIDATION,
	])("%s is terminal with no suppress_until", (code) => {
		const out = applyFailurePolicy({ failureCode: code, now: FIXED_NOW });
		expect(out.isTerminal).toBe(true);
		expect(out.suppressUntil).toBeNull();
	});

	it("content_activation_failed suppresses for 6 hours non-terminally", () => {
		const out = applyFailurePolicy({
			failureCode: FAILURE_CODES.CONTENT_ACTIVATION_FAILED,
			now: FIXED_NOW,
		});
		expect(out.isTerminal).toBe(false);
		expect(out.suppressUntil).not.toBeNull();
		const delta = (out.suppressUntil as Date).getTime() - FIXED_NOW.getTime();
		expect(minutesFromNow(delta)).toBe(6 * 60);
	});

	it("unknown codes default to non-terminal 6h suppression", () => {
		const out = applyFailurePolicy({
			failureCode: "totally_unknown_code",
			now: FIXED_NOW,
		});
		expect(out.isTerminal).toBe(false);
		const delta = (out.suppressUntil as Date).getTime() - FIXED_NOW.getTime();
		expect(minutesFromNow(delta)).toBe(6 * 60);
	});
});
