/**
 * Failure-policy mapping for enrichment stages.
 *
 * Centralizes the (stage, failureCode) -> { isTerminal, suppressUntil }
 * decision so stage handlers don't hardcode suppression durations and the
 * selector can stay code-agnostic — it only checks suppress_until.
 */

const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

export const FAILURE_CODES = {
	SOURCE_NOT_FOUND: "source_not_found",
	PROVIDER_UNAVAILABLE: "provider_unavailable",
	PROVIDER_TRANSIENT: "provider_transient",
	ANALYSIS_INPUTS_MISSING: "analysis_inputs_missing",
	ANALYSIS_BLOCKED_LYRICS_UNAVAILABLE: "analysis_blocked_lyrics_unavailable",
	ANALYSIS_BLOCKED_AUDIO_UNAVAILABLE: "analysis_blocked_audio_unavailable",
	ANALYSIS_BLOCKED_BOTH_UNAVAILABLE: "analysis_blocked_both_unavailable",
	ANALYSIS_POSTRUN_LOOKUP_UNAVAILABLE: "analysis_postrun_lookup_unavailable",
	PERMANENT: "permanent",
	VALIDATION: "validation",
	CONTENT_ACTIVATION_FAILED: "content_activation_failed",
} as const;

// Codes that escalate suppression by prior unresolved-row count. Centralised
// so the data-layer wrapper and the policy stay in lockstep — any code here
// also needs the prior-count lookup before applyFailurePolicy is called.
export const BACKOFF_CODES: ReadonlySet<string> = new Set<string>([
	FAILURE_CODES.PROVIDER_TRANSIENT,
	FAILURE_CODES.ANALYSIS_POSTRUN_LOOKUP_UNAVAILABLE,
]);

interface FailurePolicyOutcome {
	isTerminal: boolean;
	suppressUntil: Date | null;
}

interface FailurePolicyInput {
	failureCode: string;
	priorUnresolvedCount?: number;
	now?: Date;
}

const SOURCE_NOT_FOUND_SUPPRESS_MS = 30 * DAY_MS;
const PROVIDER_UNAVAILABLE_SUPPRESS_MS = 6 * HOUR_MS;
const ANALYSIS_BLOCKED_SUPPRESS_MS = 6 * HOUR_MS;
const TRANSIENT_BASE_MS = 15 * MIN_MS;
const TRANSIENT_CAP_MS = 24 * HOUR_MS;

// Default for unknown codes — non-terminal, modest backoff. Keeps unknown
// failures from wedging the selector while still avoiding hot-loops.
const UNKNOWN_DEFAULT_SUPPRESS_MS = PROVIDER_UNAVAILABLE_SUPPRESS_MS;

function computeTransientSuppressMs(priorUnresolvedCount: number): number {
	const exponent = Math.max(0, priorUnresolvedCount);
	const raw = TRANSIENT_BASE_MS * 2 ** exponent;
	if (!Number.isFinite(raw)) return TRANSIENT_CAP_MS;
	return Math.min(raw, TRANSIENT_CAP_MS);
}

export function applyFailurePolicy(
	input: FailurePolicyInput,
): FailurePolicyOutcome {
	const now = input.now ?? new Date();

	switch (input.failureCode) {
		case FAILURE_CODES.SOURCE_NOT_FOUND:
			return {
				isTerminal: false,
				suppressUntil: new Date(now.getTime() + SOURCE_NOT_FOUND_SUPPRESS_MS),
			};

		case FAILURE_CODES.PROVIDER_UNAVAILABLE:
			return {
				isTerminal: false,
				suppressUntil: new Date(
					now.getTime() + PROVIDER_UNAVAILABLE_SUPPRESS_MS,
				),
			};

		case FAILURE_CODES.PROVIDER_TRANSIENT:
		case FAILURE_CODES.ANALYSIS_POSTRUN_LOOKUP_UNAVAILABLE: {
			const ms = computeTransientSuppressMs(input.priorUnresolvedCount ?? 0);
			return {
				isTerminal: false,
				suppressUntil: new Date(now.getTime() + ms),
			};
		}

		case FAILURE_CODES.ANALYSIS_BLOCKED_LYRICS_UNAVAILABLE:
		case FAILURE_CODES.ANALYSIS_BLOCKED_AUDIO_UNAVAILABLE:
		case FAILURE_CODES.ANALYSIS_BLOCKED_BOTH_UNAVAILABLE:
			return {
				isTerminal: false,
				suppressUntil: new Date(now.getTime() + ANALYSIS_BLOCKED_SUPPRESS_MS),
			};

		case FAILURE_CODES.CONTENT_ACTIVATION_FAILED:
			return {
				isTerminal: false,
				suppressUntil: new Date(
					now.getTime() + PROVIDER_UNAVAILABLE_SUPPRESS_MS,
				),
			};

		case FAILURE_CODES.ANALYSIS_INPUTS_MISSING:
		case FAILURE_CODES.PERMANENT:
		case FAILURE_CODES.VALIDATION:
			return { isTerminal: true, suppressUntil: null };

		default:
			return {
				isTerminal: false,
				suppressUntil: new Date(now.getTime() + UNKNOWN_DEFAULT_SUPPRESS_MS),
			};
	}
}
