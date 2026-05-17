/**
 * Public entrypoint for ensuring a walkthrough match preview is up to date.
 *
 * Onboarding-only. Called from onboarding write paths (demo-song commit,
 * target-selection change) and from the read path when state looks stale.
 *
 * Decision rules:
 *   - `ready` with matching fingerprint → noop (authoritative).
 *   - non-ready with matching fingerprint:
 *       - live active preview job exists → noop (existing job will publish).
 *       - no live job → ensure fresh work (recovers stranded `pending`
 *         and `failed` rows that no longer have a runner behind them).
 *   - fingerprint mismatch (or no row) → ensure fresh work.
 *
 * Only ensures DB state (job row + preview row) — the actual computation
 * (embedding, scoring) runs in the worker.
 */

import { Result } from "better-result";
import { getTargetPlaylists } from "@/lib/domains/library/playlists/queries";
import { getActiveJob } from "@/lib/platform/jobs/repository";
import { ensureWalkthroughPreviewJob } from "@/lib/platform/jobs/walkthrough-preview-queue";

import {
	computePreviewFingerprint,
	getWalkthroughPreview,
	upsertPendingPreview,
} from "./queries";

export type EnsurePreviewOutcome =
	| { status: "ensured"; jobId: string; fingerprint: string }
	| { status: "skipped"; reason: "no_targets" | "no_demo_song" }
	| { status: "noop"; reason: "ready" | "pending_job_alive" }
	| { status: "error"; reason: string };

export interface EnsureWalkthroughPreviewArgs {
	accountId: string;
	demoSongId: string;
}

/**
 * Idempotent. Safe to call from any number of onboarding entrypoints — the
 * job-aware branches above prevent duplicate ensure() calls from creating
 * redundant jobs while a live one is already covering the same fingerprint.
 */
export async function ensureWalkthroughPreview(
	args: EnsureWalkthroughPreviewArgs,
): Promise<EnsurePreviewOutcome> {
	const targetsResult = await getTargetPlaylists(args.accountId);
	if (Result.isError(targetsResult)) {
		return {
			status: "error",
			reason: `load_targets: ${targetsResult.error.message}`,
		};
	}

	const targetPlaylistIds = targetsResult.value.map((p) => p.id).toSorted();
	if (targetPlaylistIds.length === 0) {
		// No targets path is handled by getDemoSongMatches() with the static demo
		// fallback. Don't create a preview row that would never resolve.
		return { status: "skipped", reason: "no_targets" };
	}

	const fingerprint = computePreviewFingerprint(
		args.demoSongId,
		targetPlaylistIds,
	);

	const existingResult = await getWalkthroughPreview(args.accountId);
	if (Result.isError(existingResult)) {
		return {
			status: "error",
			reason: `load_existing: ${existingResult.error.message}`,
		};
	}

	const existing = existingResult.value;

	// `ready` is authoritative: same inputs, fresh result, nothing to do.
	if (
		existing &&
		existing.fingerprint === fingerprint &&
		existing.status === "ready"
	) {
		return { status: "noop", reason: "ready" };
	}

	// Fingerprint match but non-ready: only trustworthy if a live job is
	// actually working it. Without this check we'd happily return `noop` for
	// a row stranded in `pending` when the job that was supposed to satisfy
	// it has already failed/completed/disappeared — so the onboarding session
	// would poll forever and time out into the static fallback.
	if (existing && existing.fingerprint === fingerprint) {
		const activeJob = await getActiveJob(
			args.accountId,
			"walkthrough_match_preview",
		);
		if (Result.isOk(activeJob) && activeJob.value !== null) {
			return { status: "noop", reason: "pending_job_alive" };
		}
		// Fall through to ensure a fresh job for this same fingerprint.
	}

	const jobResult = await ensureWalkthroughPreviewJob(args.accountId);
	if (Result.isError(jobResult)) {
		return {
			status: "error",
			reason: `ensure_job: ${jobResult.error.message}`,
		};
	}

	const upsertResult = await upsertPendingPreview({
		accountId: args.accountId,
		demoSongId: args.demoSongId,
		targetPlaylistIds,
		fingerprint,
		jobId: jobResult.value.id,
	});

	if (Result.isError(upsertResult)) {
		return {
			status: "error",
			reason: `upsert_preview: ${upsertResult.error.message}`,
		};
	}

	return {
		status: "ensured",
		jobId: jobResult.value.id,
		fingerprint,
	};
}
