/**
 * Server functions for onboarding flow.
 *
 * Handles theme preferences, onboarding step tracking, and playlist selection.
 * All functions require authentication and throw errors on failure.
 */

import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
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
import type {
	OnboardingAuthPayload,
	WalkthroughSong,
} from "@/lib/domains/library/accounts/onboarding-session";
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
} from "@/lib/domains/library/playlists/queries";
import { captureServerError } from "@/lib/observability/capture-server-error";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import {
	type PhaseJobIds,
	PhaseJobIdsSchema,
} from "@/lib/platform/jobs/progress/types";
import {
	deriveAuthPayloadFromPrefs,
	loadOnboardingSession,
	loadWalkthroughSong,
} from "@/lib/server/onboarding-session";
import {
	OnboardingError,
	type OnboardingErrorCause,
} from "@/lib/shared/errors/domain/onboarding";
import { themeSchema } from "@/lib/theme/types";

/**
 * Captures the cause via Sentry, then returns the typed OnboardingError to
 * throw. console-only throws never reach Sentry (enableLogs:false), so every
 * onboarding failure needs this at the throw site, not just the log line.
 */
function onboardingError(
	operation: string,
	cause: OnboardingErrorCause,
	accountId?: string,
): OnboardingError {
	captureServerError(cause, {
		area: "onboarding",
		operation,
		accountId,
	});
	return new OnboardingError(operation, cause);
}

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
			throw onboardingError("load_preferences", prefsResult.error);
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
		throw onboardingError("load_preferences", prefsResult.error);
	}
	if (Result.isError(playlistsResult)) {
		throw onboardingError("load_playlists", playlistsResult.error);
	}
	if (Result.isError(songsCountResult)) {
		throw onboardingError("load_songs_count", songsCountResult.error);
	}
	if (Result.isError(playlistsCountResult)) {
		throw onboardingError("load_playlists_count", playlistsCountResult.error);
	}
	if (Result.isError(playlistSongsCountResult)) {
		throw onboardingError(
			"load_playlist_songs_count",
			playlistSongsCountResult.error,
		);
	}
	if (Result.isError(artistsCountResult)) {
		throw onboardingError("load_artists_count", artistsCountResult.error);
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
			throw onboardingError("save_theme", result.error);
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
			throw onboardingError("load_songs_count", songsResult.error);
		}
		if (Result.isError(playlistsResult)) {
			throw onboardingError("load_playlists_count", playlistsResult.error);
		}
		if (Result.isError(playlistSongsResult)) {
			throw onboardingError(
				"load_playlist_songs_count",
				playlistSongsResult.error,
			);
		}
		if (Result.isError(artistsResult)) {
			throw onboardingError("load_artists_count", artistsResult.error);
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
			captureServerError(result.error, {
				area: "onboarding",
				operation: "reset_sync_jobs",
				accountId: session.accountId,
			});
			console.warn("Failed to reset sync jobs:", result.error);
		}
		return { success: true };
	});

/**
 * Saves the current onboarding step for resumability.
 * Clears phaseJobIds when the step is pick-color or later (post-sync).
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
				throw onboardingError("load_preferences", prefsResult.error);
			}
			if (prefsResult.value.demo_song_id === null) {
				throw onboardingError(
					"save_onboarding_step",
					new Error(`Cannot advance to ${data.step} without a demo_song_id`),
				);
			}
		}

		const result = await updateOnboardingStep(session.accountId, data.step);

		if (Result.isError(result)) {
			throw onboardingError("save_onboarding_step", result.error);
		}

		if (clearsSyncPhaseJobIds(data.step)) {
			const clearResult = await clearPhaseJobIds(session.accountId);
			if (Result.isError(clearResult)) {
				// Non-critical cleanup — log but don't fail the step save.
				captureServerError(clearResult.error, {
					area: "onboarding",
					operation: "save_onboarding_step",
					accountId: session.accountId,
					extra: { stage: "clear_phase_job_ids" },
				});
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
			throw onboardingError("complete_onboarding", result.error);
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
			throw onboardingError(
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
			throw onboardingError(
				"lookup_demo_song",
				songError ??
					new Error(`Song not found for spotify_id: ${data.spotifyTrackId}`),
			);
		}

		// No ownership check: the demo songs shown in pick-demo-song are a curated
		// landing manifest, not the user's library, so most won't be in their
		// liked_song rows. Real ownership is enforced later where it matters — in
		// addSongToPlaylist/dismissSong post-onboarding.
		const { error: updateError } = await supabase
			.from("user_preferences")
			.update({ demo_song_id: song.id })
			.eq("account_id", session.accountId);

		if (updateError) {
			throw onboardingError("save_demo_song_selection", updateError);
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
			throw onboardingError(
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
			throw onboardingError("commit_demo_song_walkthrough", updateError);
		}

		// Mirror saveOnboardingStep's side-effect: clear phase job IDs when
		// transitioning past syncing-related steps. Non-critical; log-only.
		const clearResult = await clearPhaseJobIds(session.accountId);
		if (Result.isError(clearResult)) {
			captureServerError(clearResult.error, {
				area: "onboarding",
				operation: "commit_demo_song_walkthrough",
				accountId: session.accountId,
				extra: { stage: "clear_phase_job_ids" },
			});
			console.warn("Failed to clear phase job IDs:", clearResult.error);
		}

		return loadOnboardingSession({
			accountId: session.accountId,
			accountHandle: context.account.handle,
		});
	});

// Curated demo songs used to populate the song-walkthrough /liked-songs library
// alongside the user's picked hero song. Spotify track ids from the landing
// manifest (public/landing-songs/index.json); each has a stored song_analysis,
// so they render the same analyzed panel as the hero. Over-provisioned past the
// 6-song target so the collection still fills out if the hero is one of these
// (deduped client-side) or a row is missing.
const WALKTHROUGH_COMPANION_SPOTIFY_IDS = [
	"2MvvoeRt8NcOXWESkxWn3g", // Ribs — Lorde
	"4OMJGnvZfDvsePyCwRGO7X", // Houdini — Dua Lipa
	"7DfFc7a6Rwfi3YQMRbDMau", // Thinkin Bout You — Frank Ocean
	"1Qrg8KqiBpW07V7PNxwwwL", // Kill Bill — SZA
	"6dOtVTDdiauQNBQEDOtlAB", // BIRDS OF A FEATHER — Billie Eilish
	"0VjIjW4GlUZAMYd2vXMi3b", // Blinding Lights — The Weeknd
	"4Dvkj6JhhA12EX05fT7y2e", // As It Was — Harry Styles
] as const;

/**
 * Loads the curated companion songs for the song-walkthrough /liked-songs
 * library so the demo shows a fuller (canned) library instead of a single song.
 * Returns fully-shaped `WalkthroughSong`s (real stored analyses) — identical in
 * shape and quality to the hero — so the collection hook can render them through
 * the same synthetic-row path. No ownership requirement: these are curated demo
 * songs, not the user's library, and the walkthrough runs before sync.
 */
export const getWalkthroughCompanionSongs = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async (): Promise<WalkthroughSong[]> => {
		const supabase = createAdminSupabaseClient();

		const { data: rows } = await supabase
			.from("song")
			.select("id, spotify_id")
			.in("spotify_id", [...WALKTHROUGH_COMPANION_SPOTIFY_IDS]);

		if (!rows || rows.length === 0) return [];

		// Preserve the curated order so the library reads the same every run.
		const idBySpotifyId = new Map(rows.map((r) => [r.spotify_id, r.id]));
		const orderedSongIds = WALKTHROUGH_COMPANION_SPOTIFY_IDS.map((sid) =>
			idBySpotifyId.get(sid),
		).filter((id): id is string => typeof id === "string");

		const songs = await Promise.all(
			orderedSongIds.map((id) => loadWalkthroughSong(supabase, id)),
		);

		return songs.filter((s): s is WalkthroughSong => s !== null);
	});
