/**
 * §7.2 / §7.3 — Blocked-failure escalation ladder and observability.
 *
 * Covers the bounded-convergence requirement from spec:
 *   - below threshold → non-terminal with 6h suppression
 *   - at threshold    → terminal (escalatedToInputsMissing)
 *   - compensation    → idempotent RPC fires exactly once per escalation
 *   - error detail    → blocked-skip failure rows carry the real provider error
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── mock the data-layer modules before any imports that touch them ──────────

const mockCountUnresolved = vi.fn();
const mockRecordJobItemFailure = vi.fn();
const mockGrantCompensation = vi.fn();
const mockCreateAdminSupabaseClient = vi.fn().mockReturnValue({});

vi.mock("@/lib/platform/jobs/item-failures", () => ({
	countUnresolvedJobStageFailures: (...args: unknown[]) =>
		mockCountUnresolved(...args),
	recordJobItemFailure: (...args: unknown[]) =>
		mockRecordJobItemFailure(...args),
}));

vi.mock("@/lib/domains/billing/compensation", () => ({
	grantAnalysisFailureReplacementCredit: (...args: unknown[]) =>
		mockGrantCompensation(...args),
}));

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => mockCreateAdminSupabaseClient(),
}));

import {
	applyFailurePolicy,
	BACKOFF_CODES,
	BLOCKED_ESCALATION_THRESHOLD,
	FAILURE_CODES,
} from "../failure-policy";
import { recordStageFailure } from "../record-failure";

const FIXED_NOW = new Date("2026-06-12T10:00:00Z");

// ── helpers ──────────────────────────────────────────────────────────────────

function minutesFromNow(suppressUntil: Date | null, now: Date): number {
	if (!suppressUntil) return 0;
	return Math.round((suppressUntil.getTime() - now.getTime()) / 60000);
}

const BLOCKED_CODES = [
	FAILURE_CODES.ANALYSIS_BLOCKED_LYRICS_UNAVAILABLE,
	FAILURE_CODES.ANALYSIS_BLOCKED_AUDIO_UNAVAILABLE,
	FAILURE_CODES.ANALYSIS_BLOCKED_BOTH_UNAVAILABLE,
] as const;

// ── §7.2: applyFailurePolicy escalation ──────────────────────────────────────

describe("applyFailurePolicy — blocked escalation ladder", () => {
	it.each(
		BLOCKED_CODES,
	)("%s is in BACKOFF_CODES so the prior-count lookup runs", (code) => {
		expect(BACKOFF_CODES.has(code)).toBe(true);
	});

	it.each(
		BLOCKED_CODES,
	)("%s below threshold → non-terminal with 6h suppression", (code) => {
		// Any count from 0 to threshold-1 must stay non-terminal.
		for (let count = 0; count < BLOCKED_ESCALATION_THRESHOLD; count++) {
			const out = applyFailurePolicy({
				failureCode: code,
				priorUnresolvedCount: count,
				now: FIXED_NOW,
			});
			expect(out.isTerminal).toBe(false);
			expect(out.suppressUntil).not.toBeNull();
			expect(minutesFromNow(out.suppressUntil, FIXED_NOW)).toBe(6 * 60);
			expect(out.escalatedToInputsMissing).toBeFalsy();
		}
	});

	it.each(
		BLOCKED_CODES,
	)("%s at threshold → terminal with escalatedToInputsMissing", (code) => {
		const out = applyFailurePolicy({
			failureCode: code,
			priorUnresolvedCount: BLOCKED_ESCALATION_THRESHOLD,
			now: FIXED_NOW,
		});
		expect(out.isTerminal).toBe(true);
		expect(out.suppressUntil).toBeNull();
		expect(out.escalatedToInputsMissing).toBe(true);
	});

	it.each(BLOCKED_CODES)("%s above threshold also escalates", (code) => {
		const out = applyFailurePolicy({
			failureCode: code,
			priorUnresolvedCount: BLOCKED_ESCALATION_THRESHOLD + 10,
			now: FIXED_NOW,
		});
		expect(out.isTerminal).toBe(true);
		expect(out.escalatedToInputsMissing).toBe(true);
	});

	it("BLOCKED_ESCALATION_THRESHOLD default is 4", () => {
		expect(BLOCKED_ESCALATION_THRESHOLD).toBe(4);
	});
});

// ── §7.2: recordStageFailure escalation + compensation ───────────────────────

describe("recordStageFailure — blocked escalation integration", () => {
	const BASE_PARAMS = {
		jobId: "job-1",
		accountId: "account-1",
		songId: "song-1",
		stage: "song_analysis",
		now: FIXED_NOW,
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockRecordJobItemFailure.mockResolvedValue(Result.ok(undefined));
		mockGrantCompensation.mockResolvedValue(Result.ok({ kind: "granted" }));
	});

	describe("below threshold — non-terminal, no compensation", () => {
		it.each(
			BLOCKED_CODES,
		)("%s at count 0 → non-terminal row, compensation NOT called", async (code) => {
			mockCountUnresolved.mockResolvedValue(Result.ok(0));

			const result = await recordStageFailure({
				...BASE_PARAMS,
				failureCode: code,
				errorMessage: "provider down",
			});

			expect(Result.isOk(result)).toBe(true);

			// DB row must use the original blocked code, not inputs_missing.
			expect(mockRecordJobItemFailure).toHaveBeenCalledOnce();
			const recorded = mockRecordJobItemFailure.mock.calls[0][0];
			expect(recorded.failureCode).toBe(code);
			expect(recorded.isTerminal).toBe(false);
			expect(recorded.suppressUntil).not.toBeNull();

			// Compensation must NOT fire for non-terminal failures.
			expect(mockGrantCompensation).not.toHaveBeenCalled();
		});

		it("count threshold-1 stays non-terminal", async () => {
			mockCountUnresolved.mockResolvedValue(
				Result.ok(BLOCKED_ESCALATION_THRESHOLD - 1),
			);

			const result = await recordStageFailure({
				...BASE_PARAMS,
				failureCode: FAILURE_CODES.ANALYSIS_BLOCKED_LYRICS_UNAVAILABLE,
			});

			expect(Result.isOk(result)).toBe(true);
			const recorded = mockRecordJobItemFailure.mock.calls[0][0];
			expect(recorded.isTerminal).toBe(false);
			expect(mockGrantCompensation).not.toHaveBeenCalled();
		});
	});

	describe("at threshold — terminal, compensation fires", () => {
		it.each(
			BLOCKED_CODES,
		)("%s at threshold → row recorded with analysis_inputs_missing code", async (code) => {
			mockCountUnresolved.mockResolvedValue(
				Result.ok(BLOCKED_ESCALATION_THRESHOLD),
			);

			const result = await recordStageFailure({
				...BASE_PARAMS,
				failureCode: code,
				errorMessage:
					"GeniusFetchError: Failed to fetch lyrics page (503) — https://api.genius.com/search",
			});

			expect(Result.isOk(result)).toBe(true);

			// The DB row must be rewritten to analysis_inputs_missing.
			const recorded = mockRecordJobItemFailure.mock.calls[0][0];
			expect(recorded.failureCode).toBe(FAILURE_CODES.ANALYSIS_INPUTS_MISSING);
			expect(recorded.isTerminal).toBe(true);
			expect(recorded.suppressUntil).toBeNull();
			// The real error message is preserved for observability.
			expect(recorded.errorMessage).toBe(
				"GeniusFetchError: Failed to fetch lyrics page (503) — https://api.genius.com/search",
			);
		});

		it.each(
			BLOCKED_CODES,
		)("%s at threshold → compensation RPC fires with analysis_inputs_missing", async (code) => {
			mockCountUnresolved.mockResolvedValue(
				Result.ok(BLOCKED_ESCALATION_THRESHOLD),
			);

			await recordStageFailure({
				...BASE_PARAMS,
				failureCode: code,
			});

			// Compensation must fire exactly once.
			expect(mockGrantCompensation).toHaveBeenCalledOnce();
			const [, compensationParams] = mockGrantCompensation.mock.calls[0];
			expect(compensationParams.accountId).toBe(BASE_PARAMS.accountId);
			expect(compensationParams.songId).toBe(BASE_PARAMS.songId);
			// Must pass the canonical code the DB RPC is gated on.
			expect(compensationParams.failureCode).toBe(
				FAILURE_CODES.ANALYSIS_INPUTS_MISSING,
			);
		});

		it("compensation is idempotent — already_compensated response is not an error", async () => {
			mockCountUnresolved.mockResolvedValue(
				Result.ok(BLOCKED_ESCALATION_THRESHOLD),
			);
			mockGrantCompensation.mockResolvedValue(
				Result.ok({ kind: "already_compensated" }),
			);

			const result = await recordStageFailure({
				...BASE_PARAMS,
				failureCode: FAILURE_CODES.ANALYSIS_BLOCKED_LYRICS_UNAVAILABLE,
			});

			expect(Result.isOk(result)).toBe(true);
			expect(mockGrantCompensation).toHaveBeenCalledOnce();
		});
	});

	describe("failure paths — errors are surfaced", () => {
		it("DB insert failure returns error without firing compensation", async () => {
			mockCountUnresolved.mockResolvedValue(
				Result.ok(BLOCKED_ESCALATION_THRESHOLD),
			);
			const dbError = { message: "insert failed", code: "DB_ERR" } as never;
			mockRecordJobItemFailure.mockResolvedValue(Result.err(dbError));

			const result = await recordStageFailure({
				...BASE_PARAMS,
				failureCode: FAILURE_CODES.ANALYSIS_BLOCKED_LYRICS_UNAVAILABLE,
			});

			expect(Result.isError(result)).toBe(true);
			// Compensation must NOT fire if the row write failed.
			expect(mockGrantCompensation).not.toHaveBeenCalled();
		});

		it("compensation failure is surfaced as an error", async () => {
			mockCountUnresolved.mockResolvedValue(
				Result.ok(BLOCKED_ESCALATION_THRESHOLD),
			);
			const compError = { message: "RPC failed", code: "RPC_ERR" } as never;
			mockGrantCompensation.mockResolvedValue(Result.err(compError));

			const result = await recordStageFailure({
				...BASE_PARAMS,
				failureCode: FAILURE_CODES.ANALYSIS_BLOCKED_LYRICS_UNAVAILABLE,
			});

			expect(Result.isError(result)).toBe(true);
		});
	});

	describe("non-blocked codes — escalation does not apply", () => {
		it("provider_transient at count >= threshold does NOT set escalatedToInputsMissing", () => {
			const out = applyFailurePolicy({
				failureCode: FAILURE_CODES.PROVIDER_TRANSIENT,
				priorUnresolvedCount: BLOCKED_ESCALATION_THRESHOLD + 5,
				now: FIXED_NOW,
				random: () => 1,
			});
			// transient backs off but stays non-terminal; escalation is blocked-only.
			expect(out.isTerminal).toBe(false);
			expect(out.escalatedToInputsMissing).toBeFalsy();
		});
	});
});
