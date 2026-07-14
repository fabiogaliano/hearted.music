/**
 * Liked-song access grant orchestration.
 *
 * Wraps the grant_liked_song_access(...) RPC and the post-sync auto-apply
 * decision. The RPC owns atomicity, first-writer-wins audit metadata, and the
 * top-500 snapshot; this module owns the best-effort side effects (emitting the
 * library-processing change) and the sync-time waitlist/pending precedence.
 *
 * Shared by the sync route (automatic waitlist path) and the operator CLI
 * (manual path).
 */

import { Result } from "better-result";
import type { AdminSupabaseClient } from "@/lib/data/client";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import { BillingChanges } from "@/lib/workflows/library-processing/changes";
import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";

/**
 * Reports an operational failure in the best-effort billing tail (a swallowed DB
 * error that the caller still treats as success). Injected by the caller so this
 * module stays runtime-agnostic: the Cloudflare web/operator paths wire a
 * `captureServerError` reporter, while the Bun worker wires an `@sentry/bun` one.
 * Hard-coding `@sentry/cloudflare` here would drag that SDK into the worker,
 * which calls `maybeGrantLikedSongAccessAfterSync` from the extension-sync job.
 */
export type BillingOperationalErrorReporter = (
	error: unknown,
	context: { stage: string; origin?: string },
) => void;

export type GrantOrigin = "waitlist_auto" | "operator_manual";

export type GrantLikedSongAccessResult =
	| {
			status: "applied";
			candidateCount: number;
			newlyUnlockedSongIds: string[];
	  }
	| { status: "already_applied" }
	| { status: "pending_no_liked_songs" };

interface GrantLikedSongAccessArgs {
	accountId: string;
	origin: GrantOrigin;
	requestedBy?: string | null;
	note?: string | null;
	// Caps how many top liked songs the RPC unlocks. Omit to use the RPC's
	// own default (the waitlist/sync paths do); the operator console passes a
	// clamped value for custom-limit grants.
	limit?: number;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function parseGrantOrigin(value: unknown): GrantOrigin | null {
	return value === "waitlist_auto" || value === "operator_manual"
		? value
		: null;
}

function parseGrantPayload(value: unknown): GrantLikedSongAccessResult | null {
	if (typeof value !== "object" || value === null) return null;

	const status = Reflect.get(value, "status");
	switch (status) {
		case "applied": {
			const candidateCount = Reflect.get(value, "candidate_count");
			const newlyUnlockedSongIds = Reflect.get(
				value,
				"newly_unlocked_song_ids",
			);
			if (
				typeof candidateCount === "number" &&
				isStringArray(newlyUnlockedSongIds)
			) {
				return {
					status: "applied",
					candidateCount,
					newlyUnlockedSongIds,
				};
			}
			return null;
		}
		case "already_applied":
			return { status: "already_applied" };
		case "pending_no_liked_songs":
			return { status: "pending_no_liked_songs" };
		default:
			return null;
	}
}

/**
 * Applies the liked-song access benefit to a single account via the RPC, then
 * emits a songs_unlocked library-processing change for any net-new unlocks.
 *
 * The downstream change is best-effort: a failure is logged but never discards
 * the DB grant result, matching the repo's pattern for non-transactional
 * workflow side effects.
 */
export async function grantLikedSongAccessForAccount(
	supabase: AdminSupabaseClient,
	args: GrantLikedSongAccessArgs,
	options: { onOperationalError?: BillingOperationalErrorReporter } = {},
): Promise<Result<GrantLikedSongAccessResult, DbError>> {
	const { data, error } = await supabase.rpc("grant_liked_song_access", {
		p_account_id: args.accountId,
		p_origin: args.origin,
		// null/undefined both fall through to the RPC's DEFAULT NULL.
		...(args.requestedBy ? { p_requested_by: args.requestedBy } : {}),
		...(args.note ? { p_note: args.note } : {}),
		...(typeof args.limit === "number" ? { p_limit: args.limit } : {}),
	});

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	const payload = parseGrantPayload(data);
	if (payload === null) {
		return Result.err(
			new DatabaseError({
				code: "UNEXPECTED_SHAPE",
				message: "grant_liked_song_access returned unexpected shape",
			}),
		);
	}

	if (payload.status === "applied" && payload.newlyUnlockedSongIds.length > 0) {
		const applyResult = await applyLibraryProcessingChange(
			BillingChanges.songsUnlocked(
				args.accountId,
				payload.newlyUnlockedSongIds,
			),
		);
		if (Result.isError(applyResult)) {
			console.error(
				"[liked-song-access-grant] Failed to apply library processing change:",
				applyResult.error,
			);
			// Grant committed in DB but enrichment trigger silently didn't fire.
			options.onOperationalError?.(applyResult.error, {
				stage: "apply_library_processing_change",
			});
		}
	}

	return Result.ok(payload);
}

/**
 * Sync-time auto-apply. Pending precedence first: a pre-existing grant row (from
 * a manual operator grant on an unsynced account) is applied before any waitlist
 * evaluation, so manual intent is never blocked by waitlist ineligibility. Only
 * when no row exists at all do we evaluate waitlist eligibility.
 *
 * Fully best-effort: every failure is logged and swallowed so the sync response
 * is never affected.
 */
export async function maybeGrantLikedSongAccessAfterSync(
	supabase: AdminSupabaseClient,
	accountId: string,
	options: { onOperationalError?: BillingOperationalErrorReporter } = {},
): Promise<void> {
	const { data: existingGrant, error: readError } = await supabase
		.from("account_liked_song_access_grant")
		.select("origin, applied_at")
		.eq("account_id", accountId)
		.maybeSingle();

	if (readError) {
		console.error(
			"[liked-song-access-grant] Failed to read existing grant row:",
			readError.message,
		);
		// Cannot determine grant status; sync-time best-effort path is now blind.
		options.onOperationalError?.(readError, { stage: "read_existing_grant" });
		return;
	}

	if (existingGrant) {
		// Already applied — nothing to do. Pending — retry now that this sync may
		// have populated liked songs. The RPC preserves the row's original origin.
		if (existingGrant.applied_at !== null) return;

		const origin = parseGrantOrigin(existingGrant.origin);
		if (origin === null) {
			console.error(
				"[liked-song-access-grant] Existing grant row had invalid origin:",
				existingGrant.origin,
			);
			return;
		}

		const result = await grantLikedSongAccessForAccount(
			supabase,
			{ accountId, origin },
			options,
		);
		if (Result.isError(result)) {
			console.error(
				"[liked-song-access-grant] Failed to apply pending grant:",
				result.error,
			);
			// Pre-existing operator grant failed to apply; account loses the benefit silently.
			options.onOperationalError?.(result.error, {
				stage: "apply_pending_grant",
				origin,
			});
		}
		return;
	}

	const { data: eligible, error: eligibilityError } = await supabase.rpc(
		"is_waitlist_eligible_for_liked_song_grant",
		{ p_account_id: accountId },
	);

	if (eligibilityError) {
		console.error(
			"[liked-song-access-grant] Waitlist eligibility check failed:",
			eligibilityError.message,
		);
		// Eligibility RPC failed; eligible accounts silently miss waitlist auto-grant.
		options.onOperationalError?.(eligibilityError, {
			stage: "waitlist_eligibility_check",
		});
		return;
	}

	if (eligible !== true) return;

	const result = await grantLikedSongAccessForAccount(
		supabase,
		{ accountId, origin: "waitlist_auto" },
		options,
	);
	if (Result.isError(result)) {
		console.error(
			"[liked-song-access-grant] Failed to apply waitlist grant:",
			result.error,
		);
		// Eligible account passed the RPC check but grant application failed.
		options.onOperationalError?.(result.error, {
			stage: "apply_waitlist_grant",
		});
	}
}
