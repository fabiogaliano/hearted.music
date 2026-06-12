/**
 * Server functions for onboarding flow.
 *
 * Handles theme preferences, onboarding step tracking, and playlist selection.
 * All functions require authentication and throw errors on failure.
 */

import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import { getDemoMatchesForSong } from "@/lib/content/landing/demo-matches";
import type { LandingSongManifest } from "@/lib/content/landing/landing-songs";
import { getLandingSongsManifest } from "@/lib/content/landing/landing-songs.server";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { readBillingState } from "@/lib/domains/billing/queries";
import { hasUnlimitedAccess } from "@/lib/domains/billing/state";
import {
	type ClaimHandleSeed,
	deriveClaimHandleSeed,
} from "@/lib/domains/library/accounts/claim-handle-seed";
import { completeOnboardingWithAllocations } from "@/lib/domains/library/accounts/onboarding-allocation";
import type { OnboardingAuthPayload } from "@/lib/domains/library/accounts/onboarding-session";
import { clearsSyncPhaseJobIds } from "@/lib/domains/library/accounts/onboarding-steps";
import {
	clearPhaseJobIds,
	getOrCreatePreferences,
	SAVEABLE_ONBOARDING_STEPS,
	updateOnboardingStep,
	updateTheme,
} from "@/lib/domains/library/accounts/preferences-queries";
import type { Account } from "@/lib/domains/library/accounts/queries";
import { getLibraryArtistCount } from "@/lib/domains/library/artists/queries";
import { getCount as getLikedSongCount } from "@/lib/domains/library/liked-songs/queries";
import {
	getPlaylistCount,
	getPlaylistSongCount,
	getPlaylists,
	setPlaylistTargets,
} from "@/lib/domains/library/playlists/queries";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import {
	type PhaseJobIds,
	PhaseJobIdsSchema,
} from "@/lib/platform/jobs/progress/types";
import {
	deriveAuthPayloadFromPrefs,
	loadOnboardingSession,
} from "@/lib/server/onboarding-session";
import { OnboardingError } from "@/lib/shared/errors/domain/onboarding";
import { errorMessage } from "@/lib/shared/errors/error-message";
import { themeSchema } from "@/lib/theme/types";
import { OnboardingChanges } from "@/lib/workflows/library-processing/changes/onboarding";
import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";
import {
	computePreviewFingerprint,
	getWalkthroughPreview,
	type WalkthroughPreviewMatch,
} from "@/lib/workflows/walkthrough-match-preview/queries";
import {
	type EnsurePreviewOutcome,
	ensureWalkthroughPreview,
} from "@/lib/workflows/walkthrough-match-preview/service";

/** Playlist view model for onboarding UI (camelCase frontend format) */
export interface OnboardingPlaylist {
	id: string;
	spotifyId: string;
	name: string;
	matchIntent: string | null;
	imageUrl: string | null;
	songCount: number | null;
	isTarget: boolean;
	genrePills: string[];
}

/** Sync statistics for the ready step */
export interface SyncStats {
	songs: number;
	playlists: number;
	playlistSongs: number;
	artists: number;
}

/** Copy variant for the plan selection success state, derived from billing state */
export type ReadyCopyVariant = "free" | "pack" | "unlimited";

/**
 * Full onboarding payload loaded by the `/onboarding` page. Extends the auth
 * payload with page-specific data (playlists, landing songs, sync stats,
 * copy variant, phase job ids). Guards should not read from this — they
 * should read the narrower `OnboardingAuthPayload` from the session query.
 */
export interface OnboardingData extends OnboardingAuthPayload {
	accountId: string;
	claimHandleSeed: ClaimHandleSeed;
	playlists: OnboardingPlaylist[];
	/** Active phase job IDs for refresh resilience (null if no active sync) */
	phaseJobIds: PhaseJobIds | null;
	/** Library stats (liked songs + playlists count) from DB */
	syncStats: SyncStats;
	/** Copy variant for plan-selection success state based on billing state */
	readyCopyVariant: ReadyCopyVariant;
	/** Landing songs manifest for pick-demo-song step */
	landingSongs: LandingSongManifest[];
}

const themeInputSchema = z.object({
	theme: themeSchema,
});

// `complete` is intentionally absent — completion is written via
// markOnboardingComplete (which stamps onboarding_completed_at), never by
// directly setting the step column.
const saveableStepInputSchema = z.object({
	step: SAVEABLE_ONBOARDING_STEPS,
});

const playlistIdsInputSchema = z.object({
	playlistIds: z.array(z.uuid()),
});

type PreviewEnsureSource =
	| "save_playlist_targets"
	| "commit_demo_song"
	| "get_demo_song_matches";

function logPreviewEnsureOutcome(args: {
	accountId: string;
	source: PreviewEnsureSource;
	outcome: EnsurePreviewOutcome;
}) {
	console.info("[onboarding] walkthrough preview ensure outcome", {
		accountId: args.accountId,
		source: args.source,
		outcome: args.outcome,
	});
}

async function awaitWalkthroughPreviewEnsure(args: {
	accountId: string;
	demoSongId: string;
	source: PreviewEnsureSource;
}): Promise<void> {
	try {
		const outcome = await ensureWalkthroughPreview({
			accountId: args.accountId,
			demoSongId: args.demoSongId,
		});
		logPreviewEnsureOutcome({
			accountId: args.accountId,
			source: args.source,
			outcome,
		});
	} catch (err) {
		console.warn(
			"[onboarding] ensure walkthrough preview failed:",
			errorMessage(err),
		);
	}
}

function fireAndForgetWalkthroughPreviewEnsure(args: {
	accountId: string;
	demoSongId: string;
	source: PreviewEnsureSource;
}) {
	void awaitWalkthroughPreviewEnsure(args);
}

/**
 * Full page-data loader used by the `/onboarding` route. Supersets the
 * guard payload with playlists, landing songs, sync stats, and the copy
 * variant derived from billing. Pure projection — no DB writes.
 *
 * Takes the full account row so both the auth payload and claim-handle seed
 * can be derived without an extra DB lookup.
 */
async function loadOnboardingData({
	accountId,
	account,
}: {
	accountId: string;
	account: Account;
}): Promise<OnboardingData> {
	const supabase = createAdminSupabaseClient();

	// Single prefs fetch shared with authPayload derivation. Walkthrough song
	// (inside authPayloadPromise) runs concurrently with the other queries.
	// account row is threaded from context so we avoid any extra lookups.
	const prefsPromise = getOrCreatePreferences(accountId);
	const authPayloadPromise = (async () => {
		const prefsResult = await prefsPromise;
		if (Result.isError(prefsResult)) {
			throw new OnboardingError("load_preferences", prefsResult.error);
		}
		return deriveAuthPayloadFromPrefs({
			accountId,
			accountHandle: account.handle,
			prefs: prefsResult.value,
			supabase,
		});
	})();

	const [
		authPayload,
		prefsResult,
		playlistsResult,
		songsCountResult,
		playlistsCountResult,
		playlistSongsCountResult,
		artistsCountResult,
		billingResult,
	] = await Promise.all([
		authPayloadPromise,
		prefsPromise,
		getPlaylists(accountId),
		getLikedSongCount(accountId),
		getPlaylistCount(accountId),
		getPlaylistSongCount(accountId),
		getLibraryArtistCount(accountId),
		readBillingState(supabase, accountId),
	]);

	if (Result.isError(prefsResult)) {
		throw new OnboardingError("load_preferences", prefsResult.error);
	}
	if (Result.isError(playlistsResult)) {
		throw new OnboardingError("load_playlists", playlistsResult.error);
	}
	if (Result.isError(songsCountResult)) {
		throw new OnboardingError("load_songs_count", songsCountResult.error);
	}
	if (Result.isError(playlistsCountResult)) {
		throw new OnboardingError(
			"load_playlists_count",
			playlistsCountResult.error,
		);
	}
	if (Result.isError(playlistSongsCountResult)) {
		throw new OnboardingError(
			"load_playlist_songs_count",
			playlistSongsCountResult.error,
		);
	}
	if (Result.isError(artistsCountResult)) {
		throw new OnboardingError("load_artists_count", artistsCountResult.error);
	}

	const playlists = playlistsResult.value.map((p) => ({
		id: p.id,
		spotifyId: p.spotify_id,
		name: p.name,
		matchIntent: p.match_intent,
		imageUrl: p.image_url,
		songCount: p.song_count,
		isTarget: p.is_target ?? false,
		genrePills: p.genre_pills ?? [],
	}));

	let readyCopyVariant: ReadyCopyVariant = "free";
	if (Result.isOk(billingResult)) {
		const billing = billingResult.value;
		if (hasUnlimitedAccess(billing)) {
			readyCopyVariant = "unlimited";
		} else if (billing.creditBalance > 0) {
			readyCopyVariant = "pack";
		}
	}

	const phaseJobIdsParse = PhaseJobIdsSchema.safeParse(
		prefsResult.value.phase_job_ids,
	);

	// Derived from the explicit account row — same source used for authPayload,
	// so the seed's "owned" branch is consistent with the session's handle state.
	const claimHandleSeed = deriveClaimHandleSeed({
		accountHandle: account.handle,
		displayName: account.display_name,
	});

	return {
		...authPayload,
		accountId,
		claimHandleSeed,
		playlists,
		phaseJobIds: phaseJobIdsParse.success ? phaseJobIdsParse.data : null,
		syncStats: {
			songs: songsCountResult.value,
			playlists: playlistsCountResult.value,
			playlistSongs: playlistSongsCountResult.value,
			artists: artistsCountResult.value,
		},
		readyCopyVariant,
		landingSongs: getLandingSongsManifest(),
	};
}

/**
 * Gets all onboarding data for the authenticated user.
 * Loads theme, playlists, current step, and completion status in parallel.
 *
 * Throws error if user is not authenticated or DB operations fail.
 */
export const getOnboardingData = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(
		({ context }): Promise<OnboardingData> =>
			loadOnboardingData({
				accountId: context.session.accountId,
				account: context.account,
			}),
	);

/**
 * Small, guard-critical projection of onboarding state. Used by the
 * authenticated layout's `beforeLoad` to drive route resolution. Returns
 * only the `OnboardingSession` DU + theme — no playlists, landing songs,
 * or sync stats. Safe to refetch with `staleTime: 0` on every navigation.
 */
export const getOnboardingSession = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(
		({ context }): Promise<OnboardingAuthPayload> =>
			loadOnboardingSession({
				accountId: context.session.accountId,
				accountHandle: context.account.handle,
			}),
	);

/**
 * Saves the user's theme preference.
 * Creates preferences record if it doesn't exist.
 */
export const saveThemePreference = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator(themeInputSchema)
	.handler(async ({ data, context }): Promise<{ success: true }> => {
		const { session } = context;

		const result = await updateTheme(session.accountId, data.theme);

		if (Result.isError(result)) {
			throw new OnboardingError("save_theme", result.error);
		}

		return { success: true };
	});

/**
 * Returns library summary counts from DB (populated by extension sync).
 * Replaces the old Spotify API-based discovery that required OAuth tokens.
 */
export const getLibrarySummary = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<SyncStats> => {
		const { session } = context;

		const [songsResult, playlistsResult, playlistSongsResult, artistsResult] =
			await Promise.all([
				getLikedSongCount(session.accountId),
				getPlaylistCount(session.accountId),
				getPlaylistSongCount(session.accountId),
				getLibraryArtistCount(session.accountId),
			]);

		if (Result.isError(songsResult)) {
			throw new OnboardingError("load_songs_count", songsResult.error);
		}
		if (Result.isError(playlistsResult)) {
			throw new OnboardingError("load_playlists_count", playlistsResult.error);
		}
		if (Result.isError(playlistSongsResult)) {
			throw new OnboardingError(
				"load_playlist_songs_count",
				playlistSongsResult.error,
			);
		}
		if (Result.isError(artistsResult)) {
			throw new OnboardingError("load_artists_count", artistsResult.error);
		}

		return {
			songs: songsResult.value,
			playlists: playlistsResult.value,
			playlistSongs: playlistSongsResult.value,
			artists: artistsResult.value,
		};
	});

/**
 * No-op sync executor - sync is now handled externally by the Chrome extension.
 * Kept for type compatibility; the extension POSTs data directly via /api/extension/sync.
 */
export const executeSync = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator(z.object({ phaseJobIds: PhaseJobIdsSchema }))
	.handler(async (): Promise<{ success: true }> => {
		return { success: true };
	});

/**
 * Clears phaseJobIds so SyncingStep starts fresh when a new sync is triggered.
 * Called from InstallExtensionStep before navigating to the syncing step.
 */
export const resetSyncJobs = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<{ success: true }> => {
		const { session } = context;
		const result = await clearPhaseJobIds(session.accountId);
		if (Result.isError(result)) {
			console.warn("Failed to reset sync jobs:", result.error);
		}
		return { success: true };
	});

/**
 * Saves the current onboarding step for resumability.
 * Clears phaseJobIds when the step is claim-handle or later (post-sync).
 * Updates the DB every time the user navigates to a new step.
 *
 * Rejects `complete` at the schema boundary — completion must go through
 * markOnboardingComplete, which stamps onboarding_completed_at.
 *
 * Rejects song/match walkthrough if demo_song_id is null to prevent the
 * impossible state where step="song-walkthrough" with no demo song.
 */
export const saveOnboardingStep = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator(saveableStepInputSchema)
	.handler(async ({ data, context }): Promise<{ success: true }> => {
		const { session } = context;

		// Walkthrough steps require a demo song to already exist — atomicity is
		// guaranteed by commitDemoSongAndEnterWalkthrough; anything else landing
		// here with no song is a buggy caller.
		if (data.step === "song-walkthrough" || data.step === "match-walkthrough") {
			const prefsResult = await getOrCreatePreferences(session.accountId);
			if (Result.isError(prefsResult)) {
				throw new OnboardingError("load_preferences", prefsResult.error);
			}
			if (prefsResult.value.demo_song_id === null) {
				throw new OnboardingError(
					"save_onboarding_step",
					new Error(`Cannot advance to ${data.step} without a demo_song_id`),
				);
			}
		}

		const result = await updateOnboardingStep(session.accountId, data.step);

		if (Result.isError(result)) {
			throw new OnboardingError("save_onboarding_step", result.error);
		}

		if (clearsSyncPhaseJobIds(data.step)) {
			const clearResult = await clearPhaseJobIds(session.accountId);
			if (Result.isError(clearResult)) {
				// Non-critical cleanup — log but don't fail the step save.
				console.warn("Failed to clear phase job IDs:", clearResult.error);
			}
		}

		return { success: true };
	});

export type MarkOnboardingCompleteResult = {
	status: "completed_now" | "already_complete" | "not_ready";
	onboarding: OnboardingAuthPayload;
};

/**
 * Structured completion gate for the onboarding flow.
 *
 * - `already_complete`: session is already complete; returns current payload.
 *   Does NOT re-run completeOnboardingWithAllocations (no duplicate side-effects).
 * - `not_ready`: session is not at plan-selection (covers earlier steps and
 *   handle-less rows collapsed to claim-handle). Returns authoritative payload.
 * - `completed_now`: session was at plan-selection AND this call won the
 *   compare-and-set completion write; free allocation granted.
 *
 * The pre-read gate below is a UX courtesy (it produces the not_ready payload
 * and short-circuits the obvious already-complete case); the safety mechanism
 * against concurrent completes is completeOnboarding's compare-and-set write —
 * `ok(null)` means another call won the race, so this one reports
 * `already_complete` without having run any side effects.
 *
 * The returned onboarding payload is always authoritative — callers must patch
 * their cache and navigate via resolveSession, never hardcode a destination.
 */
export const markOnboardingComplete = createServerFn({
	method: "POST",
})
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<MarkOnboardingCompleteResult> => {
		const { session: authSession, account } = context;
		const accountId = authSession.accountId;

		// Load authoritative session before deciding anything.
		const currentOnboarding = await loadOnboardingSession({
			accountId,
			accountHandle: account.handle,
		});

		if (currentOnboarding.session.status === "complete") {
			return { status: "already_complete", onboarding: currentOnboarding };
		}

		if (currentOnboarding.session.status !== "plan-selection") {
			// Covers steps before plan-selection and handle-less rows pinned to
			// claim-handle. Return authoritative state so the client can recover.
			return { status: "not_ready", onboarding: currentOnboarding };
		}

		// Only here when authoritative session is exactly plan-selection.
		const supabase = createAdminSupabaseClient();
		const result = await completeOnboardingWithAllocations(supabase, accountId);

		if (Result.isError(result)) {
			throw new OnboardingError("complete_onboarding", result.error);
		}

		// account.handle comes fresh from the DB on every server call (auth
		// middleware refetches the row), and the plan-selection gate above
		// guarantees it is non-null — a handle-less row would have been pinned
		// to claim-handle and returned not_ready. Handles are immutable in v0,
		// so no post-write re-read is needed.
		const freshOnboarding = await loadOnboardingSession({
			accountId,
			accountHandle: account.handle,
		});

		if (freshOnboarding.session.status !== "complete") {
			throw new OnboardingError(
				"complete_onboarding",
				new Error(
					`[onboarding invariant] post-write session is ${freshOnboarding.session.status}, expected "complete"`,
				),
			);
		}

		return {
			// ok(null) = a concurrent call won the compare-and-set; completion
			// happened either way, but only the winner ran the allocation.
			status: result.value === null ? "already_complete" : "completed_now",
			onboarding: freshOnboarding,
		};
	});

/**
 * Saves target playlist selection (batch update).
 * Takes an array of playlist IDs to mark as targets.
 * All other playlists for this account will be unmarked.
 */
export const savePlaylistTargets = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator(playlistIdsInputSchema)
	.handler(async ({ data, context }): Promise<{ success: true }> => {
		const { session } = context;

		const targetsResult = await setPlaylistTargets(
			session.accountId,
			data.playlistIds,
		);
		if (Result.isError(targetsResult)) {
			throw new OnboardingError("update_playlist_targets", targetsResult.error);
		}

		const applyResult = await applyLibraryProcessingChange(
			OnboardingChanges.targetSelectionConfirmed(session.accountId),
		);
		if (Result.isError(applyResult)) {
			console.error(
				"[onboarding] library-processing apply failed:",
				applyResult.error,
			);
		}

		// If the user has already chosen a demo song (e.g. they navigated back to
		// edit targets), invalidate the existing preview by rotating its
		// fingerprint and ensuring a new background job. The preview row's
		// `target_playlist_ids` is what we score against, so it must mirror the
		// user's latest selection.
		const prefsForPreview = await getOrCreatePreferences(session.accountId);
		if (
			Result.isOk(prefsForPreview) &&
			prefsForPreview.value.demo_song_id !== null
		) {
			await awaitWalkthroughPreviewEnsure({
				accountId: session.accountId,
				demoSongId: prefsForPreview.value.demo_song_id,
				source: "save_playlist_targets",
			});
		}

		return { success: true };
	});

const saveDemoSongSelectionInputSchema = z.object({
	spotifyTrackId: z.string().min(1),
});

/**
 * Saves the user's demo song selection during onboarding.
 * Looks up the song by Spotify ID and stores the UUID in user_preferences.
 */
export const saveDemoSongSelection = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator(saveDemoSongSelectionInputSchema)
	.handler(async ({ data, context }): Promise<{ success: true }> => {
		const { session } = context;
		const supabase = createAdminSupabaseClient();

		const { data: song, error: songError } = await supabase
			.from("song")
			.select("id")
			.eq("spotify_id", data.spotifyTrackId)
			.single();

		if (songError || !song) {
			throw new OnboardingError(
				"lookup_demo_song",
				songError ??
					new Error(`Song not found for spotify_id: ${data.spotifyTrackId}`),
			);
		}

		// No ownership check: the demo songs shown in pick-demo-song are a curated
		// landing manifest, not the user's library, so most won't be in their
		// liked_song rows. The walkthrough preview enriches and scores any song by
		// id (see executeWalkthroughPreview), and real ownership is enforced later
		// where it matters — in addSongToPlaylist/dismissSong post-onboarding.
		const { error: updateError } = await supabase
			.from("user_preferences")
			.update({ demo_song_id: song.id })
			.eq("account_id", session.accountId);

		if (updateError) {
			throw new OnboardingError("save_demo_song_selection", updateError);
		}

		return { success: true };
	});

/**
 * Atomic transition from `pick-demo-song` → `song-walkthrough`.
 *
 * Writes `demo_song_id` and `onboarding_step` in a single UPDATE so the row
 * can never land in the impossible state `step = "song-walkthrough"` with no
 * `demo_song_id` (which would cause the onboarding redirect loop between
 * /onboarding and /liked-songs). Returns the full new `OnboardingData` so
 * the client can replace its cache authoritatively before navigating — no
 * partial `setQueryData` patches, no stale reads by route guards.
 */
export const commitDemoSongAndEnterWalkthrough = createServerFn({
	method: "POST",
})
	.middleware([authMiddleware])
	.inputValidator(saveDemoSongSelectionInputSchema)
	.handler(async ({ data, context }): Promise<OnboardingAuthPayload> => {
		const { session } = context;
		const supabase = createAdminSupabaseClient();

		const { data: song, error: songError } = await supabase
			.from("song")
			.select("id")
			.eq("spotify_id", data.spotifyTrackId)
			.single();

		if (songError || !song) {
			throw new OnboardingError(
				"lookup_demo_song",
				songError ??
					new Error(`Song not found for spotify_id: ${data.spotifyTrackId}`),
			);
		}

		// No ownership check: see saveDemoSongSelection. Demo songs come from the
		// curated landing manifest, not the user's library, so requiring a
		// liked_song row would reject most valid picks.
		const { error: updateError } = await supabase
			.from("user_preferences")
			.update({
				demo_song_id: song.id,
				onboarding_step: "song-walkthrough",
			})
			.eq("account_id", session.accountId);

		if (updateError) {
			throw new OnboardingError("commit_demo_song_walkthrough", updateError);
		}

		// Mirror saveOnboardingStep's side-effect: clear phase job IDs when
		// transitioning past syncing-related steps. Non-critical; log-only.
		const clearResult = await clearPhaseJobIds(session.accountId);
		if (Result.isError(clearResult)) {
			console.warn("Failed to clear phase job IDs:", clearResult.error);
		}

		await awaitWalkthroughPreviewEnsure({
			accountId: session.accountId,
			demoSongId: song.id,
			source: "commit_demo_song",
		});

		return loadOnboardingSession({
			accountId: session.accountId,
			accountHandle: context.account.handle,
		});
	});

/** Match result for a single playlist in the demo song showcase */
export interface DemoMatchPlaylist {
	id: string;
	name: string;
	description: string | null;
	songCount: number | null;
	score: number;
}

/** Result of matching the demo song against target playlists */
export type DemoMatchResult =
	| { status: "ready"; matches: DemoMatchPlaylist[]; isDemo: boolean }
	| { status: "pending" }
	| { status: "unavailable" };

/**
 * Fetches match results for the demo song against the user's target playlists.
 * No-playlists path: returns static demo matches immediately.
 * Real-playlists path: returns live match results from the match snapshot.
 * Returns "pending" if the match snapshot hasn't been published yet,
 * "unavailable" if no demo song is selected, or "ready" with sorted matches.
 */
export const getDemoSongMatches = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<DemoMatchResult> => {
		const { session } = context;

		const prefsResult = await getOrCreatePreferences(session.accountId);
		if (Result.isError(prefsResult)) {
			return { status: "unavailable" };
		}

		const demoSongId = prefsResult.value.demo_song_id;
		if (!demoSongId) {
			return { status: "unavailable" };
		}

		// Check if user has target playlists
		const playlistsResult = await getPlaylists(session.accountId);
		const hasTargetPlaylists =
			Result.isOk(playlistsResult) &&
			playlistsResult.value.some((p) => p.is_target);

		if (!hasTargetPlaylists) {
			// No-playlists path: look up spotify_id, return static demo matches
			const supabase = createAdminSupabaseClient();
			const { data: song } = await supabase
				.from("song")
				.select("spotify_id")
				.eq("id", demoSongId)
				.single();

			if (!song) {
				return { status: "unavailable" };
			}

			const demoMatches = getDemoMatchesForSong(song.spotify_id);
			const matches: DemoMatchPlaylist[] = demoMatches.map((m) => ({
				id: m.id,
				name: m.name,
				description: m.reason,
				songCount: null,
				score: m.matchScore,
			}));

			return { status: "ready", matches, isDemo: true };
		}

		// Real-playlists path: read from the dedicated walkthrough preview row.
		// Deliberately does NOT touch match_snapshot / match_result — production
		// matching filters by minScoreThreshold and entitled-candidate
		// membership, which would routinely drop the demo song.
		const targetPlaylistIds = playlistsResult.value
			.filter((p) => p.is_target)
			.map((p) => p.id)
			.toSorted();
		const expectedFingerprint = computePreviewFingerprint(
			demoSongId,
			targetPlaylistIds,
		);

		const previewResult = await getWalkthroughPreview(session.accountId);
		if (Result.isError(previewResult)) {
			return { status: "pending" };
		}

		const preview = previewResult.value;

		// `ready` is the only authoritative state. For anything else — missing
		// row, stale fingerprint, or `pending`/`failed` with no live job — we
		// fire ensure() and tell the UI to keep polling. ensure() is now
		// job-aware, so it will not duplicate work when a live job is already
		// running; it only creates fresh work when state is genuinely stranded.
		const isReady =
			preview !== null &&
			preview.fingerprint === expectedFingerprint &&
			preview.status === "ready";

		if (!isReady) {
			fireAndForgetWalkthroughPreviewEnsure({
				accountId: session.accountId,
				demoSongId,
				source: "get_demo_song_matches",
			});
			return { status: "pending" };
		}

		if (!preview) {
			// Unreachable thanks to isReady, but the type guard helps TypeScript
			// narrow `preview` for the rest of the handler.
			return { status: "pending" };
		}

		const previewMatches = parsePreviewMatches(preview.matches);
		if (previewMatches.length === 0) {
			return { status: "pending" };
		}

		const playlistIds = previewMatches.map((m) => m.playlistId);
		const supabase = createAdminSupabaseClient();
		const { data: playlistRows, error: playlistError } = await supabase
			.from("playlist")
			.select("id, name, match_intent, song_count")
			.in("id", playlistIds);

		if (playlistError || !playlistRows) {
			return { status: "pending" };
		}

		const playlistMap = new Map(playlistRows.map((p) => [p.id, p]));

		const matches: DemoMatchPlaylist[] = previewMatches
			.map((m) => {
				const playlist = playlistMap.get(m.playlistId);
				if (!playlist) return null;
				return {
					id: playlist.id,
					name: playlist.name,
					description: playlist.match_intent,
					songCount: playlist.song_count,
					score: m.score,
				};
			})
			.filter((m): m is DemoMatchPlaylist => m !== null)
			.toSorted((a, b) => b.score - a.score);

		return { status: "ready", matches, isDemo: false };
	});

/**
 * Decode the JSON `matches` column on a preview row into typed entries.
 * The DB column is JSONB so the runtime shape isn't enforced by the type
 * system — defensive parsing keeps the contract self-contained here instead
 * of leaking jsonb-typed shapes into the UI layer.
 */
function parsePreviewMatches(value: unknown): WalkthroughPreviewMatch[] {
	if (!Array.isArray(value)) return [];
	const out: WalkthroughPreviewMatch[] = [];
	for (const entry of value) {
		if (
			entry !== null &&
			typeof entry === "object" &&
			"playlistId" in entry &&
			"score" in entry &&
			typeof (entry as { playlistId: unknown }).playlistId === "string" &&
			typeof (entry as { score: unknown }).score === "number"
		) {
			const e = entry as {
				playlistId: string;
				score: number;
				factors?: { embedding?: number; audio?: number; genre?: number };
			};
			out.push({
				playlistId: e.playlistId,
				score: e.score,
				factors: {
					embedding: e.factors?.embedding ?? 0,
					audio: e.factors?.audio ?? 0,
					genre: e.factors?.genre ?? 0,
				},
			});
		}
	}
	return out;
}
