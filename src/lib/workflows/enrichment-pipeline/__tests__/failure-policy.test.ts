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
				// random=1 -> jitter resolves to the full window, exposing the curve.
				random: () => 1,
			});
			expect(out.isTerminal).toBe(false);
			const delta = (out.suppressUntil as Date).getTime() - FIXED_NOW.getTime();
			expect(minutesFromNow(delta)).toBe(minutes);
		}
	});

	it("provider_transient applies equal jitter: half the window at random=0, full at random=1", () => {
		// Count 2 -> 60m base window. Equal jitter keeps half (30m) and randomizes
		// the other half, so the window lands in [30m, 60m].
		const low = applyFailurePolicy({
			failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
			priorUnresolvedCount: 2,
			now: FIXED_NOW,
			random: () => 0,
		});
		const high = applyFailurePolicy({
			failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
			priorUnresolvedCount: 2,
			now: FIXED_NOW,
			random: () => 1,
		});
		expect(
			minutesFromNow(
				(low.suppressUntil as Date).getTime() - FIXED_NOW.getTime(),
			),
		).toBe(30);
		expect(
			minutesFromNow(
				(high.suppressUntil as Date).getTime() - FIXED_NOW.getTime(),
			),
		).toBe(60);
	});

	it("provider_transient floors the window with a provider retryAfterMs", () => {
		// Base window at count 0 is 15m; a 45m Retry-After must raise the floor,
		// regardless of where jitter lands within the base window.
		const out = applyFailurePolicy({
			failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
			priorUnresolvedCount: 0,
			retryAfterMs: 45 * 60 * 1000,
			now: FIXED_NOW,
			random: () => 0,
		});
		const delta = (out.suppressUntil as Date).getTime() - FIXED_NOW.getTime();
		expect(minutesFromNow(delta)).toBe(45);
	});

	it("provider_transient keeps the computed backoff when it exceeds retryAfterMs", () => {
		// Count 4 -> 240m backoff dominates a 30m Retry-After floor.
		const out = applyFailurePolicy({
			failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
			priorUnresolvedCount: 4,
			retryAfterMs: 30 * 60 * 1000,
			now: FIXED_NOW,
			random: () => 1,
		});
		const delta = (out.suppressUntil as Date).getTime() - FIXED_NOW.getTime();
		expect(minutesFromNow(delta)).toBe(240);
	});

	it("retryAfterMs floor is still bounded by the 24h transient cap", () => {
		const out = applyFailurePolicy({
			failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
			priorUnresolvedCount: 0,
			retryAfterMs: 72 * 60 * 60 * 1000,
			now: FIXED_NOW,
			random: () => 1,
		});
		const delta = (out.suppressUntil as Date).getTime() - FIXED_NOW.getTime();
		expect(minutesFromNow(delta)).toBe(24 * 60);
	});

	it("provider_transient caps at 24h regardless of escalation count", () => {
		const out = applyFailurePolicy({
			failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
			priorUnresolvedCount: 50,
			now: FIXED_NOW,
			random: () => 1,
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
				random: () => 1,
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
		expect(BACKOFF_CODES.has(FAILURE_CODES.ANALYSIS_RETRY_CANDIDATE)).toBe(
			true,
		);
		expect(
			BACKOFF_CODES.has(FAILURE_CODES.ANALYSIS_LYRICS_REFRESH_PENDING),
		).toBe(true);
	});

	it("analysis_retry_candidate backs off from 6h to a 7d cap", () => {
		const cases: { count: number; minutes: number }[] = [
			{ count: 0, minutes: 6 * 60 },
			{ count: 1, minutes: 12 * 60 },
			{ count: 2, minutes: 24 * 60 },
			{ count: 3, minutes: 48 * 60 },
			{ count: 4, minutes: 96 * 60 },
			{ count: 5, minutes: 168 * 60 },
			{ count: 50, minutes: 168 * 60 },
		];
		for (const { count, minutes } of cases) {
			const out = applyFailurePolicy({
				failureCode: FAILURE_CODES.ANALYSIS_RETRY_CANDIDATE,
				priorUnresolvedCount: count,
				now: FIXED_NOW,
				random: () => 1,
			});
			expect(out.isTerminal).toBe(false);
			const delta = (out.suppressUntil as Date).getTime() - FIXED_NOW.getTime();
			expect(minutesFromNow(delta)).toBe(minutes);
		}
	});

	it("analysis_lyrics_refresh_pending backs off from 24h to a 30d cap", () => {
		const cases: { count: number; minutes: number }[] = [
			{ count: 0, minutes: 24 * 60 },
			{ count: 1, minutes: 48 * 60 },
			{ count: 2, minutes: 96 * 60 },
			{ count: 3, minutes: 192 * 60 },
			{ count: 4, minutes: 384 * 60 },
			{ count: 5, minutes: 30 * 24 * 60 },
			{ count: 50, minutes: 30 * 24 * 60 },
		];
		for (const { count, minutes } of cases) {
			const out = applyFailurePolicy({
				failureCode: FAILURE_CODES.ANALYSIS_LYRICS_REFRESH_PENDING,
				priorUnresolvedCount: count,
				now: FIXED_NOW,
				random: () => 1,
			});
			expect(out.isTerminal).toBe(false);
			const delta = (out.suppressUntil as Date).getTime() - FIXED_NOW.getTime();
			expect(minutesFromNow(delta)).toBe(minutes);
		}
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
