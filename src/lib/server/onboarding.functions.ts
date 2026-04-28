/**
 * Server functions for onboarding flow.
 *
 * Handles theme preferences, onboarding step tracking, and playlist selection.
 * All functions require authentication and throw errors on failure.
 */

import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";

import {
	clearPhaseJobIds,
	completeOnboarding,
	getOrCreatePreferences,
	ONBOARDING_STEPS,
	type OnboardingStep,
	type UserPreferences,
	updateOnboardingStep,
	updateTheme,
} from "@/lib/domains/library/accounts/preferences-queries";
import { readBillingState } from "@/lib/domains/billing/queries";
import { hasUnlimitedAccess } from "@/lib/domains/billing/state";
import { grantFreeAllocation } from "@/lib/domains/billing/unlocks";
import { getCount as getLikedSongCount } from "@/lib/domains/library/liked-songs/queries";
import {
	getPlaylistCount,
	getPlaylists,
	setPlaylistTarget,
} from "@/lib/domains/library/playlists/queries";
import { createAdminSupabaseClient } from "@/lib/data/client";
import {
	computePreviewFingerprint,
	getWalkthroughPreview,
	type WalkthroughPreviewMatch,
} from "@/lib/workflows/walkthrough-match-preview/queries";
import { ensureWalkthroughPreview } from "@/lib/workflows/walkthrough-match-preview/service";

import { getDemoMatchesForSong } from "@/lib/data/demo-matches";
import type { LandingSongManifest } from "@/lib/data/landing-songs";
import { getLandingSongsManifest } from "@/lib/data/landing-songs.server";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import {
	type PhaseJobIds,
	PhaseJobIdsSchema,
} from "@/lib/platform/jobs/progress/types";
import { OnboardingError } from "@/lib/shared/errors/domain/onboarding";
import { type ThemeColor, themeSchema } from "@/lib/theme/types";
import { generateSongSlug } from "@/lib/utils/slug";
import { OnboardingChanges } from "@/lib/workflows/library-processing/changes/onboarding";
import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";
import type {
	OnboardingSession,
	WalkthroughSong,
} from "@/features/onboarding/step-resolver";
import type { AnalysisContent } from "@/features/liked-songs/types";

/** Playlist view model for onboarding UI (camelCase frontend format) */
export interface OnboardingPlaylist {
	id: string;
	name: string;
	description: string | null;
	imageUrl: string | null;
	songCount: number | null;
	isTarget: boolean;
}

/** Sync statistics for the ready step */
export interface SyncStats {
	songs: number;
	playlists: number;
}

/** Copy variant for the plan selection success state, derived from billing state */
export type ReadyCopyVariant = "free" | "pack" | "unlimited";

/**
 * Guard-critical payload. Tiny, canonical, always refetched fresh so route
 * `beforeLoad` reads a fully-consistent session. Loaded via
 * `getOnboardingSession` on the auth layout.
 */
export interface OnboardingAuthPayload {
	/** Canonical lifecycle state. Walkthrough variants carry their song inline. */
	session: OnboardingSession;
	/** User's theme preference (null = hasn't chosen yet) */
	theme: ThemeColor | null;
}

/**
 * Full onboarding payload loaded by the `/onboarding` page. Extends the auth
 * payload with page-specific data (playlists, landing songs, sync stats,
 * copy variant, phase job ids). Guards should not read from this — they
 * should read the narrower `OnboardingAuthPayload` from the session query.
 */
export interface OnboardingData extends OnboardingAuthPayload {
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

const stepInputSchema = z.object({
	step: ONBOARDING_STEPS,
});

const playlistIdsInputSchema = z.object({
	playlistIds: z.array(z.uuid()),
});

/**
 * Project a persisted `(onboarding_step, demo_song_id)` pair into the
 * canonical `OnboardingSession` discriminated union.
 *
 * Pure — never writes to the DB. If the persisted step implies a precondition
 * that isn't satisfied (e.g. `song-walkthrough` without a resolved song), we
 * throw loudly in dev (catches the class of bug early during local testing)
 * and fall back to `pick-demo-song` in prod so users don't get stuck in a
 * redirect loop. Historical bad rows are cleaned by the corresponding
 * migration; new bad rows can't be produced because
 * `commitDemoSongAndEnterWalkthrough` writes both columns atomically.
 */
function deriveSession(
	accountId: string,
	onboardingStep: OnboardingStep,
	onboardingCompletedAt: string | null,
	walkthroughSong: WalkthroughSong | null,
): OnboardingSession {
	// `session.status === "complete"` is ONLY producible from a non-null
	// completion timestamp. The persisted step column is advisory; the
	// timestamp is the authority so partial writes can't fabricate a
	// ghost-complete session.
	if (onboardingCompletedAt !== null) {
		return { status: "complete" };
	}

	// Inconsistent row: step="complete" without a timestamp. Loud in dev so
	// the offending write path gets fixed; safe fallback in prod to the final
	// pre-complete step so the user doesn't get stuck in a bogus complete
	// state that skips `markOnboardingComplete`'s side effects.
	if (onboardingStep === "complete") {
		const message =
			`[onboarding invariant] step="complete" for account ${accountId} ` +
			`has no onboarding_completed_at. Falling back to "plan-selection".`;
		if (import.meta.env.DEV) {
			throw new Error(message);
		}
		console.error(message);
		return { status: "plan-selection" };
	}

	const needsDemoSong =
		onboardingStep === "song-walkthrough" ||
		onboardingStep === "match-walkthrough";

	if (needsDemoSong && walkthroughSong === null) {
		const message =
			`[onboarding invariant] step=${onboardingStep} for account ${accountId} ` +
			`has no demo_song_id. Atomic transitions should make this impossible.`;
		if (import.meta.env.DEV) {
			// Loud: surface the invariant violation immediately during local
			// development. If this fires, fix the code path that produced it
			// instead of relying on the prod fallback below.
			throw new Error(message);
		}
		console.error(message);
		return { status: "pick-demo-song" };
	}

	if (onboardingStep === "song-walkthrough" && walkthroughSong) {
		return { status: "song-walkthrough", song: walkthroughSong };
	}
	if (onboardingStep === "match-walkthrough" && walkthroughSong) {
		return { status: "match-walkthrough", song: walkthroughSong };
	}

	// Exhaustive projection for the remaining non-complete, non-walkthrough
	// steps. Replaces the previous unsafe `as OnboardingSession` cast —
	// TypeScript now verifies every `OnboardingStep` value is handled.
	switch (onboardingStep) {
		case "welcome":
		case "pick-color":
		case "install-extension":
		case "syncing":
		case "flag-playlists":
		case "pick-demo-song":
		case "plan-selection":
			return { status: onboardingStep };
		case "song-walkthrough":
		case "match-walkthrough":
			// Unreachable: walkthrough-with-song returns above; walkthrough
			// without song is coerced by the invariant branch. Kept so the
			// compiler treats the switch as exhaustive without a `never`
			// assertion on `onboardingStep`.
			return { status: "pick-demo-song" };
	}
}

/**
 * Derives an `OnboardingAuthPayload` from already-fetched preferences so
 * callers that need both session + additional page data can share a single
 * prefs fetch. Resolves the walkthrough song lazily (only when `demo_song_id`
 * is set) so the no-walkthrough path stays one round-trip.
 */
async function deriveAuthPayloadFromPrefs(
	accountId: string,
	prefs: UserPreferences,
	supabase: ReturnType<typeof createAdminSupabaseClient>,
): Promise<OnboardingAuthPayload> {
	const stepParse = ONBOARDING_STEPS.safeParse(prefs.onboarding_step);
	const onboardingStep: OnboardingStep = stepParse.success
		? stepParse.data
		: "welcome";

	const walkthroughSong = await loadWalkthroughSong(
		supabase,
		prefs.demo_song_id,
	);

	const session = deriveSession(
		accountId,
		onboardingStep,
		prefs.onboarding_completed_at,
		walkthroughSong,
	);

	return { session, theme: prefs.theme };
}

/**
 * Guard-critical loader. Fetches only prefs + (optionally) the demo song.
 * Used by `getOnboardingSession`, which the auth layout polls on every
 * navigation with `staleTime: 0`. Small object, cheap refetch.
 */
async function loadOnboardingSession(
	accountId: string,
): Promise<OnboardingAuthPayload> {
	const supabase = createAdminSupabaseClient();
	const prefsResult = await getOrCreatePreferences(accountId);
	if (Result.isError(prefsResult)) {
		throw new OnboardingError("load_preferences", prefsResult.error);
	}

	return deriveAuthPayloadFromPrefs(accountId, prefsResult.value, supabase);
}

/**
 * Loads the persisted demo song (if any) as a `WalkthroughSong`. Returns
 * `null` if no demo song is selected, or if the join fails — callers are
 * expected to handle the null case (and `deriveSession` encodes what that
 * null means for the session variant).
 */
async function loadWalkthroughSong(
	supabase: ReturnType<typeof createAdminSupabaseClient>,
	demoSongId: string | null,
): Promise<WalkthroughSong | null> {
	if (!demoSongId) return null;

	const [{ data: song }, { data: analysisRow }] = await Promise.all([
		supabase
			.from("song")
			.select(
				"id, spotify_id, name, artists, artist_ids, genres, album_name, image_url",
			)
			.eq("id", demoSongId)
			.single(),
		supabase
			.from("song_analysis")
			.select("id, analysis, model, created_at")
			.eq("song_id", demoSongId)
			.order("created_at", { ascending: false })
			.limit(1)
			.maybeSingle(),
	]);

	if (!song) return null;

	const artist = song.artists[0] ?? "Unknown Artist";
	const artistSpotifyId = song.artist_ids?.[0] ?? null;

	let artistImageUrl: string | null = null;
	if (artistSpotifyId) {
		const { data: artistRow } = await supabase
			.from("artist")
			.select("image_url")
			.eq("spotify_id", artistSpotifyId)
			.maybeSingle();
		artistImageUrl = artistRow?.image_url ?? null;
	}

	return {
		id: song.id,
		spotifyTrackId: song.spotify_id,
		slug: generateSongSlug(artist, song.name),
		name: song.name,
		artist,
		artistId: artistSpotifyId,
		artistImageUrl,
		album: song.album_name,
		albumArtUrl: song.image_url,
		genres: song.genres ?? [],
		analysis: analysisRow
			? {
					id: analysisRow.id,
					content: analysisRow.analysis as AnalysisContent,
					model: analysisRow.model,
					createdAt: analysisRow.created_at,
				}
			: null,
	};
}

/**
 * Full page-data loader used by the `/onboarding` route. Supersets the
 * guard payload with playlists, landing songs, sync stats, and the copy
 * variant derived from billing. Pure projection — no DB writes.
 */
async function loadOnboardingData(accountId: string): Promise<OnboardingData> {
	const supabase = createAdminSupabaseClient();

	// Single prefs fetch shared with authPayload derivation. Walkthrough song
	// (inside authPayloadPromise) runs concurrently with the other queries.
	const prefsPromise = getOrCreatePreferences(accountId);
	const authPayloadPromise = (async () => {
		const prefsResult = await prefsPromise;
		if (Result.isError(prefsResult)) {
			throw new OnboardingError("load_preferences", prefsResult.error);
		}
		return deriveAuthPayloadFromPrefs(accountId, prefsResult.value, supabase);
	})();

	const [
		authPayload,
		prefsResult,
		playlistsResult,
		songsCountResult,
		playlistsCountResult,
		billingResult,
	] = await Promise.all([
		authPayloadPromise,
		prefsPromise,
		getPlaylists(accountId),
		getLikedSongCount(accountId),
		getPlaylistCount(accountId),
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

	const playlists = playlistsResult.value.map((p) => ({
		id: p.id,
		name: p.name,
		description: p.description,
		imageUrl: p.image_url,
		songCount: p.song_count,
		isTarget: p.is_target ?? false,
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

	return {
		...authPayload,
		playlists,
		phaseJobIds: phaseJobIdsParse.success ? phaseJobIdsParse.data : null,
		syncStats: {
			songs: songsCountResult.value,
			playlists: playlistsCountResult.value,
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
			loadOnboardingData(context.session.accountId),
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
			loadOnboardingSession(context.session.accountId),
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
	.handler(
		async ({ context }): Promise<{ songs: number; playlists: number }> => {
			const { session } = context;

			const [songsResult, playlistsResult] = await Promise.all([
				getLikedSongCount(session.accountId),
				getPlaylistCount(session.accountId),
			]);

			if (Result.isError(songsResult)) {
				throw new OnboardingError("load_songs_count", songsResult.error);
			}
			if (Result.isError(playlistsResult)) {
				throw new OnboardingError(
					"load_playlists_count",
					playlistsResult.error,
				);
			}

			return {
				songs: songsResult.value,
				playlists: playlistsResult.value,
			};
		},
	);

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
 * Clears phaseJobIds when transitioning past syncing step.
 * Updates the DB every time the user navigates to a new step.
 */
export const saveOnboardingStep = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator(stepInputSchema)
	.handler(async ({ data, context }): Promise<{ success: true }> => {
		const { session } = context;

		const result = await updateOnboardingStep(session.accountId, data.step);

		if (Result.isError(result)) {
			throw new OnboardingError("save_onboarding_step", result.error);
		}

		// Clear phase job IDs when transitioning past syncing step
		if (
			data.step === "flag-playlists" ||
			data.step === "pick-demo-song" ||
			data.step === "song-walkthrough" ||
			data.step === "match-walkthrough" ||
			data.step === "plan-selection"
		) {
			const clearResult = await clearPhaseJobIds(session.accountId);
			if (Result.isError(clearResult)) {
				// Log but don't fail - cleanup is not critical
				console.warn("Failed to clear phase job IDs:", clearResult.error);
			}
		}

		return { success: true };
	});

/**
 * Marks onboarding as complete.
 * Sets onboarding_completed_at timestamp in the database.
 * For free-plan users, grants up to 10 most-recent liked songs as free allocation.
 */
export const markOnboardingComplete = createServerFn({
	method: "POST",
})
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<{ success: true }> => {
		const { session } = context;

		const result = await completeOnboarding(session.accountId);

		if (Result.isError(result)) {
			throw new OnboardingError("complete_onboarding", result.error);
		}

		const supabase = createAdminSupabaseClient();
		const billingResult = await readBillingState(supabase, session.accountId);

		if (Result.isOk(billingResult)) {
			const billing = billingResult.value;
			const isFree =
				billing.plan === "free" &&
				!hasUnlimitedAccess(billing) &&
				billing.creditBalance === 0;

			if (isFree) {
				const allocationResult = await grantFreeAllocation(
					supabase,
					session.accountId,
				);
				if (Result.isError(allocationResult)) {
					console.error(
						"[onboarding] Free allocation failed:",
						allocationResult.error,
					);
				}
			}
		} else {
			console.error(
				"[onboarding] Failed to read billing state for free allocation:",
				billingResult.error,
			);
		}

		return { success: true };
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

		const playlistsResult = await getPlaylists(session.accountId);

		if (Result.isError(playlistsResult)) {
			throw new OnboardingError("get_playlists", playlistsResult.error);
		}

		const updates = playlistsResult.value.map((playlist) => {
			const shouldBeTarget = data.playlistIds.includes(playlist.id);
			return setPlaylistTarget(playlist.id, shouldBeTarget);
		});

		const results = await Promise.all(updates);

		const firstError = results.find(Result.isError);
		if (firstError) {
			throw new OnboardingError("update_playlist_targets", firstError.error);
		}

		await applyLibraryProcessingChange(
			OnboardingChanges.targetSelectionConfirmed(session.accountId),
		);

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
			ensureWalkthroughPreview({
				accountId: session.accountId,
				demoSongId: prefsForPreview.value.demo_song_id,
			}).catch((err) => {
				console.warn(
					"[onboarding] ensure walkthrough preview failed:",
					err instanceof Error ? err.message : String(err),
				);
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

		// Kick the walkthrough preview as soon as the demo song is locked in.
		// The user spends time on /liked-songs before reaching /match, so this
		// gives the worker a head start. Failure is non-fatal — the UI falls
		// back to the static demo path on timeout.
		ensureWalkthroughPreview({
			accountId: session.accountId,
			demoSongId: song.id,
		}).catch((err) => {
			console.warn(
				"[onboarding] ensure walkthrough preview failed:",
				err instanceof Error ? err.message : String(err),
			);
		});

		return loadOnboardingSession(session.accountId);
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
			ensureWalkthroughPreview({
				accountId: session.accountId,
				demoSongId,
			}).catch((err) => {
				console.warn(
					"[onboarding] ensure walkthrough preview failed:",
					err instanceof Error ? err.message : String(err),
				);
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
			.select("id, name, description, song_count")
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
					description: playlist.description,
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
