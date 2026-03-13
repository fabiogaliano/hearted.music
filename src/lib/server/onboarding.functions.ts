/**
 * Server functions for onboarding flow.
 *
 * Handles theme preferences, onboarding step tracking, and playlist selection.
 * All functions require authentication and throw errors on failure.
 */

import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import { requireAuthSession } from "@/lib/platform/auth/auth.server";
import { getCount as getLikedSongCount } from "@/lib/domains/library/liked-songs/queries";
import {
	getPlaylistCount,
	getPlaylists,
	setPlaylistDestination,
} from "@/lib/domains/library/playlists/queries";
import {
	clearPhaseJobIds,
	completeOnboarding,
	getOrCreatePreferences,
	getPhaseJobIds,
	isOnboardingComplete,
	ONBOARDING_STEPS,
	type OnboardingStep,
	updateOnboardingStep,
	updateTheme,
} from "@/lib/domains/library/accounts/preferences-queries";
import {
	type PhaseJobIds,
	PhaseJobIdsSchema,
} from "@/lib/platform/jobs/progress/types";
import { OnboardingError } from "@/lib/shared/errors/domain/onboarding";
import { type ThemeColor, themeSchema } from "@/lib/theme/types";
import {
	runDestinationProfiling,
	runMatching,
} from "@/lib/workflows/enrichment-pipeline/orchestrator";

/** Playlist view model for onboarding UI (camelCase frontend format) */
export interface OnboardingPlaylist {
	id: string;
	name: string;
	description: string | null;
	imageUrl: string | null;
	songCount: number | null;
	isDestination: boolean;
}

/** Sync statistics for the ready step */
export interface SyncStats {
	songs: number;
	playlists: number;
}

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
export const getOnboardingData = createServerFn({ method: "GET" }).handler(
	async (): Promise<OnboardingData> => {
		const { session } = await requireAuthSession();

		const [
			prefsResult,
			playlistsResult,
			completionResult,
			songsCountResult,
			playlistsCountResult,
		] = await Promise.all([
			getOrCreatePreferences(session.accountId),
			getPlaylists(session.accountId),
			isOnboardingComplete(session.accountId),
			getLikedSongCount(session.accountId),
			getPlaylistCount(session.accountId),
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
			isDestination: p.is_destination ?? false,
		}));

		// Validate currentStep with Zod instead of unsafe type assertion
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
		};
	},
);

/**
 * Saves the user's theme preference.
 * Creates preferences record if it doesn't exist.
 */
export const saveThemePreference = createServerFn({ method: "POST" })
	.inputValidator(themeInputSchema)
	.handler(async ({ data }): Promise<{ success: true }> => {
		const { session } = await requireAuthSession();

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
export const getLibrarySummary = createServerFn({ method: "GET" }).handler(
	async (): Promise<{ songs: number; playlists: number }> => {
		const { session } = await requireAuthSession();

		const [songsResult, playlistsResult] = await Promise.all([
			getLikedSongCount(session.accountId),
			getPlaylistCount(session.accountId),
		]);

		if (Result.isError(songsResult)) {
			throw new OnboardingError("load_songs_count", songsResult.error);
		}
		if (Result.isError(playlistsResult)) {
			throw new OnboardingError("load_playlists_count", playlistsResult.error);
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
	.inputValidator(z.object({ phaseJobIds: PhaseJobIdsSchema }))
	.handler(async (): Promise<{ success: true }> => {
		await requireAuthSession();
		return { success: true };
	});

/**
 * Clears phaseJobIds so SyncingStep starts fresh when a new sync is triggered.
 * Called from InstallExtensionStep before navigating to the syncing step.
 */
export const resetSyncJobs = createServerFn({ method: "POST" }).handler(
	async (): Promise<{ success: true }> => {
		const { session } = await requireAuthSession();
		const result = await clearPhaseJobIds(session.accountId);
		if (Result.isError(result)) {
			console.warn("Failed to reset sync jobs:", result.error);
		}
		return { success: true };
	},
);

/**
 * Polls for phaseJobIds from the database.
 * Used by SyncingStep when waiting for the extension to trigger sync.
 * Returns null if no active sync jobs exist yet.
 */
export const pollPhaseJobIds = createServerFn({ method: "GET" }).handler(
	async (): Promise<PhaseJobIds | null> => {
		const { session } = await requireAuthSession();

		const result = await getPhaseJobIds(session.accountId);
		if (Result.isError(result)) {
			throw new OnboardingError("poll_phase_job_ids", result.error);
		}

		return result.value;
	},
);

/**
 * Saves the current onboarding step for resumability.
 * Clears phaseJobIds when transitioning past syncing step.
 * Updates the DB every time the user navigates to a new step.
 */
export const saveOnboardingStep = createServerFn({ method: "POST" })
	.inputValidator(stepInputSchema)
	.handler(async ({ data }): Promise<{ success: true }> => {
		const { session } = await requireAuthSession();

		const result = await updateOnboardingStep(session.accountId, data.step);

		if (Result.isError(result)) {
			throw new OnboardingError("save_onboarding_step", result.error);
		}

		// Clear phase job IDs when transitioning past syncing step
		if (data.step === "flag-playlists" || data.step === "ready") {
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
 */
export const markOnboardingComplete = createServerFn({
	method: "POST",
}).handler(async (): Promise<{ success: true }> => {
	const { session } = await requireAuthSession();

	const result = await completeOnboarding(session.accountId);

	if (Result.isError(result)) {
		throw new OnboardingError("complete_onboarding", result.error);
	}

	return { success: true };
});

/**
 * Saves playlist destinations (batch update).
 * Takes an array of playlist IDs to mark as destinations.
 * All other playlists for this account will be unmarked.
 */
export const savePlaylistDestinations = createServerFn({ method: "POST" })
	.inputValidator(playlistIdsInputSchema)
	.handler(async ({ data }): Promise<{ success: true }> => {
		const { session } = await requireAuthSession();

		const playlistsResult = await getPlaylists(session.accountId);

		if (Result.isError(playlistsResult)) {
			throw new OnboardingError("get_playlists", playlistsResult.error);
		}

		const updates = playlistsResult.value.map((playlist) => {
			const shouldBeDestination = data.playlistIds.includes(playlist.id);
			return setPlaylistDestination(playlist.id, shouldBeDestination);
		});

		const results = await Promise.all(updates);

		const firstError = results.find(Result.isError);
		if (firstError) {
			throw new OnboardingError(
				"update_playlist_destinations",
				firstError.error,
			);
		}

		if (data.playlistIds.length === 0) {
			return { success: true };
		}

		const songCountResult = await getLikedSongCount(session.accountId);
		if (Result.isError(songCountResult) || songCountResult.value === 0) {
			return { success: true };
		}

		// Fire-and-forget: destination-side work runs without blocking the save response
		void (async () => {
			try {
				const profilingResult = await runDestinationProfiling(
					session.accountId,
				);
				if (Result.isError(profilingResult)) {
					console.error(
						"[onboarding] Destination profiling bootstrap failed:",
						profilingResult.error.message,
					);
					return;
				}

				for (const stage of profilingResult.value.stages) {
					if (stage.status === "failed") {
						console.error(
							`[onboarding] Destination profiling stage failed: ${stage.error ?? "unknown error"}`,
						);
					}
				}

				const matchingResult = await runMatching(session.accountId);
				if (Result.isError(matchingResult)) {
					console.error(
						"[onboarding] Matching bootstrap failed:",
						matchingResult.error.message,
					);
					return;
				}

				for (const stage of matchingResult.value.stages) {
					if (stage.status === "failed") {
						console.error(
							`[onboarding] Matching stage failed: ${stage.error ?? "unknown error"}`,
						);
					}
				}
			} catch (error) {
				console.error("[onboarding] Destination follow-on work failed:", error);
			}
		})();

		return { success: true };
	});
