/**
 * Server functions for onboarding flow.
 *
 * Handles theme preferences, onboarding step tracking, and playlist selection.
 * All functions require authentication and throw errors on failure.
 */

import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import { get as getAnalysis } from "@/lib/domains/enrichment/content-analysis/queries";
import {
	clearPhaseJobIds,
	completeOnboarding,
	getOrCreatePreferences,
	isOnboardingComplete,
	ONBOARDING_STEPS,
	type OnboardingStep,
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
import {
	getLatestMatchSnapshot,
	getMatchResultsForSong,
} from "@/lib/domains/taste/song-matching/queries";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Json } from "@/lib/data/database.types";
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
import { OnboardingChanges } from "@/lib/workflows/library-processing/changes/onboarding";
import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";

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

/** Copy variant for ReadyStep, derived from billing state */
export type ReadyCopyVariant = "free" | "pack" | "unlimited";

/** Combined onboarding data loaded on route entry */
export interface OnboardingData {
	/** User's theme preference (null = hasn't chosen yet) */
	theme: ThemeColor | null;
	playlists: OnboardingPlaylist[];
	currentStep: OnboardingStep;
	isComplete: boolean;
	/** Active phase job IDs for refresh resilience (null if no active sync) */
	phaseJobIds: PhaseJobIds | null;
	/** Library stats (liked songs + playlists count) from DB */
	syncStats: SyncStats;
	/** Copy variant for ReadyStep based on billing state */
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
 * Gets all onboarding data for the authenticated user.
 * Loads theme, playlists, current step, and completion status in parallel.
 *
 * Throws error if user is not authenticated or DB operations fail.
 */
export const getOnboardingData = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<OnboardingData> => {
		const { session } = context;

		const supabase = createAdminSupabaseClient();

		const [
			prefsResult,
			playlistsResult,
			completionResult,
			songsCountResult,
			playlistsCountResult,
			billingResult,
		] = await Promise.all([
			getOrCreatePreferences(session.accountId),
			getPlaylists(session.accountId),
			isOnboardingComplete(session.accountId),
			getLikedSongCount(session.accountId),
			getPlaylistCount(session.accountId),
			readBillingState(supabase, session.accountId),
		]);

		if (Result.isError(prefsResult)) {
			throw new OnboardingError("load_preferences", prefsResult.error);
		}
		if (Result.isError(playlistsResult)) {
			throw new OnboardingError("load_playlists", playlistsResult.error);
		}
		if (Result.isError(completionResult)) {
			throw new OnboardingError("check_completion", completionResult.error);
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

		// Validate currentStep with Zod instead of unsafe type assertion
		let readyCopyVariant: ReadyCopyVariant = "free";
		if (Result.isOk(billingResult)) {
			const billing = billingResult.value;
			if (hasUnlimitedAccess(billing)) {
				readyCopyVariant = "unlimited";
			} else if (billing.creditBalance > 0) {
				readyCopyVariant = "pack";
			}
		}

		const stepParse = ONBOARDING_STEPS.safeParse(
			prefsResult.value.onboarding_step,
		);

		const phaseJobIdsParse = PhaseJobIdsSchema.safeParse(
			prefsResult.value.phase_job_ids,
		);

		return {
			theme: prefsResult.value.theme,
			playlists,
			currentStep: stepParse.success ? stepParse.data : "welcome",
			isComplete: completionResult.value,
			phaseJobIds: phaseJobIdsParse.success ? phaseJobIdsParse.data : null,
			syncStats: {
				songs: songsCountResult.value,
				playlists: playlistsCountResult.value,
			},
			readyCopyVariant,
			landingSongs: getLandingSongsManifest(),
		};
	});

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
			data.step === "plan-selection" ||
			data.step === "ready"
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
 * For free-plan users, grants up to 15 most-recent liked songs as free allocation.
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

/** Demo song data returned for the onboarding showcase */
export interface DemoSongData {
	song: {
		name: string;
		artists: string[];
		albumName: string | null;
		imageUrl: string | null;
		genres: string[];
		spotifyTrackId: string;
	};
	analysis: Json;
}

/**
 * Fetches the user's selected demo song and its analysis for the onboarding showcase.
 * Returns null if user hasn't selected a demo song or the song/analysis is missing.
 */
export const getDemoSongShowcase = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<DemoSongData | null> => {
		const { session } = context;

		const prefsResult = await getOrCreatePreferences(session.accountId);
		if (Result.isError(prefsResult)) {
			console.warn("Failed to load preferences for demo song showcase");
			return null;
		}

		const demoSongId = prefsResult.value.demo_song_id;
		if (!demoSongId) {
			return null;
		}

		const supabase = createAdminSupabaseClient();

		const { data: song, error: songError } = await supabase
			.from("song")
			.select("name, artists, album_name, image_url, genres, spotify_id")
			.eq("id", demoSongId)
			.single();

		if (songError || !song) {
			console.warn("Demo song not found:", demoSongId, songError?.message);
			return null;
		}

		const analysisResult = await getAnalysis(demoSongId);
		if (Result.isError(analysisResult) || !analysisResult.value) {
			console.warn("Demo song analysis not found:", demoSongId);
			return null;
		}

		return {
			song: {
				name: song.name,
				artists: song.artists,
				albumName: song.album_name,
				imageUrl: song.image_url,
				genres: song.genres,
				spotifyTrackId: song.spotify_id,
			},
			analysis: analysisResult.value.analysis,
		};
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

		// Real-playlists path: fetch live match results
		const snapshotResult = await getLatestMatchSnapshot(session.accountId);
		if (Result.isError(snapshotResult) || !snapshotResult.value) {
			return { status: "pending" };
		}

		const snapshot = snapshotResult.value;
		const matchResultsResult = await getMatchResultsForSong(
			snapshot.id,
			demoSongId,
		);

		if (Result.isError(matchResultsResult)) {
			return { status: "pending" };
		}

		const matchResults = matchResultsResult.value;
		if (matchResults.length === 0) {
			return { status: "pending" };
		}

		const playlistIds = matchResults.map((mr) => mr.playlist_id);
		const supabase = createAdminSupabaseClient();
		const { data: playlistRows, error: playlistError } = await supabase
			.from("playlist")
			.select("id, name, description, song_count")
			.in("id", playlistIds);

		if (playlistError || !playlistRows) {
			return { status: "pending" };
		}

		const playlistMap = new Map(playlistRows.map((p) => [p.id, p]));

		const matches: DemoMatchPlaylist[] = matchResults
			.map((mr) => {
				const playlist = playlistMap.get(mr.playlist_id);
				if (!playlist) return null;
				return {
					id: playlist.id,
					name: playlist.name,
					description: playlist.description,
					songCount: playlist.song_count,
					score: mr.score,
				};
			})
			.filter((m): m is DemoMatchPlaylist => m !== null)
			.toSorted((a, b) => b.score - a.score);

		return { status: "ready", matches, isDemo: false };
	});
