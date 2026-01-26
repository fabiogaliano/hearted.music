/**
 * Server functions for onboarding flow.
 *
 * Handles theme preferences, onboarding step tracking, and playlist selection.
 * All functions require authentication and throw errors on failure.
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { Result } from "better-result";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import {
	getOrCreatePreferences,
	updateTheme,
	updateOnboardingStep,
	completeOnboarding,
	isOnboardingComplete,
	updatePhaseJobIds,
	clearPhaseJobIds,
	ONBOARDING_STEPS,
	type OnboardingStep,
} from "@/lib/data/preferences";
import { themeSchema, type ThemeColor } from "@/lib/theme/types";
import { getPlaylists, getPlaylistCount, setPlaylistDestination } from "@/lib/data/playlists";
import { getCount as getLikedSongCount } from "@/lib/data/liked-song";
import { createJob, getJobById } from "@/lib/data/jobs";
import { OnboardingError } from "@/lib/shared/errors/domain/onboarding";
import { SyncOrchestrator } from "@/lib/capabilities/sync/orchestrator";
import { getSpotifyService } from "@/lib/integrations/spotify";
import { PhaseJobIdsSchema, type PhaseJobIds } from "@/lib/jobs/progress/types";

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Validators
// ============================================================================

const themeInputSchema = z.object({
	theme: themeSchema,
});

const stepInputSchema = z.object({
	step: ONBOARDING_STEPS,
});

const playlistIdsInputSchema = z.object({
	playlistIds: z.array(z.string().uuid()),
});

// ============================================================================
// Data Loading
// ============================================================================

/**
 * Gets all onboarding data for the authenticated user.
 * Loads theme, playlists, current step, and completion status in parallel.
 *
 * Throws error if user is not authenticated or DB operations fail.
 */
export const getOnboardingData = createServerFn({ method: "GET" }).handler(
	async (): Promise<OnboardingData> => {
		const request = getRequest();
		const session = requireSession(request);

		// Load all data in parallel (including counts for ready step)
		const [prefsResult, playlistsResult, completionResult, songsCountResult, playlistsCountResult] =
			await Promise.all([
				getOrCreatePreferences(session.accountId),
				getPlaylists(session.accountId),
				isOnboardingComplete(session.accountId),
				getLikedSongCount(session.accountId),
				getPlaylistCount(session.accountId),
			]);

		// Check for errors and throw as OnboardingError
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
			throw new OnboardingError("load_playlists_count", playlistsCountResult.error);
		}

		// Transform playlists to frontend-friendly format
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

		// Parse phaseJobIds from JSONB (validate structure)
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

// ============================================================================
// Theme Preferences
// ============================================================================

/**
 * Saves the user's theme preference.
 * Creates preferences record if it doesn't exist.
 */
export const saveThemePreference = createServerFn({ method: "POST" })
	.inputValidator(themeInputSchema)
	.handler(async ({ data }): Promise<{ success: true }> => {
		const request = getRequest();
		const session = requireSession(request);

		const result = await updateTheme(session.accountId, data.theme);

		if (Result.isError(result)) {
			throw new OnboardingError("save_theme", result.error);
		}

		return { success: true };
	});

// ============================================================================
// Job Management
// ============================================================================

/**
 * Creates 3 separate sync jobs (one per phase) for the user.
 * Persists the job IDs to DB for refresh resilience.
 * Called from WelcomeStep when the user clicks "Continue".
 */
export const createSyncJob = createServerFn({ method: "POST" }).handler(
	async (): Promise<PhaseJobIds> => {
		const request = getRequest();
		const session = requireSession(request);

		const [songsResult, playlistsResult, tracksResult] = await Promise.all([
			createJob(session.accountId, "sync_liked_songs"),
			createJob(session.accountId, "sync_playlists"),
			createJob(session.accountId, "sync_playlist_tracks"),
		]);

		if (Result.isError(songsResult)) {
			throw new OnboardingError("create_sync_jobs", songsResult.error);
		}
		if (Result.isError(playlistsResult)) {
			throw new OnboardingError("create_sync_jobs", playlistsResult.error);
		}
		if (Result.isError(tracksResult)) {
			throw new OnboardingError("create_sync_jobs", tracksResult.error);
		}

		const phaseJobIds: PhaseJobIds = {
			liked_songs: songsResult.value.id,
			playlists: playlistsResult.value.id,
			playlist_tracks: tracksResult.value.id,
		};

		// Persist to DB for refresh resilience
		const persistResult = await updatePhaseJobIds(session.accountId, phaseJobIds);
		if (Result.isError(persistResult)) {
			// Log but don't fail - jobs are already created
			console.warn("Failed to persist phaseJobIds:", persistResult.error);
		}

		return phaseJobIds;
	},
);

const startSyncInputSchema = z.object({
	phaseJobIds: PhaseJobIdsSchema,
});

/** Terminal job statuses that shouldn't be restarted */
const TERMINAL_STATUSES = new Set(["completed", "failed"]);

/**
 * Starts the sync process with 3 separate phase jobs.
 * Idempotent: returns success if jobs are already running or completed.
 * Progress is streamed via SSE to /api/jobs/$id/progress for each job.
 */
export const startSync = createServerFn({ method: "POST" })
	.inputValidator(startSyncInputSchema)
	.handler(async ({ data }): Promise<{ success: true }> => {
		const request = getRequest();
		const session = requireSession(request);

		// Fetch all 3 jobs in parallel
		const jobEntries = Object.entries(data.phaseJobIds) as [string, string][];
		const jobResults = await Promise.all(
			jobEntries.map(async ([phase, jobId]) => ({
				phase,
				jobId,
				result: await getJobById(jobId),
			})),
		);

		// Validate ownership and collect job statuses
		const jobs: { phase: string; job: NonNullable<Awaited<ReturnType<typeof getJobById>> extends Result<infer T, unknown> ? T : never> }[] = [];

		for (const { phase, result } of jobResults) {
			if (Result.isError(result)) {
				throw new OnboardingError(
					"start_sync",
					new Error(`Failed to get ${phase} job`),
				);
			}
			const job = result.value;
			if (!job || job.account_id !== session.accountId) {
				throw new OnboardingError(
					"start_sync",
					new Error(`${phase} job not found`),
				);
			}
			jobs.push({ phase, job });
		}

		// Idempotency check: if all jobs are terminal (completed/failed), return early
		const allTerminal = jobs.every((j) => TERMINAL_STATUSES.has(j.job.status));
		if (allTerminal) {
			return { success: true };
		}

		// If any job is already running, return early (sync in progress)
		const anyRunning = jobs.some((j) => j.job.status === "running");
		if (anyRunning) {
			return { success: true };
		}

		// Only proceed if at least one job is pending
		const anyPending = jobs.some((j) => j.job.status === "pending");
		if (!anyPending) {
			// All jobs are in unexpected state - shouldn't happen
			return { success: true };
		}

		// Get SpotifyService for this user
		const spotifyResult = await getSpotifyService(session.accountId);
		if (Result.isError(spotifyResult)) {
			throw new OnboardingError("start_sync", new Error("Spotify not connected"));
		}

		// Create orchestrator and run sync
		const orchestrator = new SyncOrchestrator(spotifyResult.value);
		const syncResult = await orchestrator.fullSync(
			session.accountId,
			data.phaseJobIds,
		);

		if (Result.isError(syncResult)) {
			throw new OnboardingError("start_sync", syncResult.error);
		}

		return { success: true };
	});

// ============================================================================
// Onboarding Step Tracking
// ============================================================================

/**
 * Saves the current onboarding step for resumability.
 * Clears phaseJobIds when transitioning past syncing step.
 * Updates the DB every time the user navigates to a new step.
 */
export const saveOnboardingStep = createServerFn({ method: "POST" })
	.inputValidator(stepInputSchema)
	.handler(async ({ data }): Promise<{ success: true }> => {
		const request = getRequest();
		const session = requireSession(request);

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
export const markOnboardingComplete = createServerFn({ method: "POST" }).handler(
	async (): Promise<{ success: true }> => {
		const request = getRequest();
		const session = requireSession(request);

		const result = await completeOnboarding(session.accountId);

		if (Result.isError(result)) {
			throw new OnboardingError("complete_onboarding", result.error);
		}

		return { success: true };
	},
);

// ============================================================================
// Playlist Selection
// ============================================================================

/**
 * Saves playlist destinations (batch update).
 * Takes an array of playlist IDs to mark as destinations.
 * All other playlists for this account will be unmarked.
 */
export const savePlaylistDestinations = createServerFn({ method: "POST" })
	.inputValidator(playlistIdsInputSchema)
	.handler(async ({ data }): Promise<{ success: true }> => {
		const request = getRequest();
		const session = requireSession(request);

		// Get all user's playlists
		const playlistsResult = await getPlaylists(session.accountId);

		if (Result.isError(playlistsResult)) {
			throw new OnboardingError("get_playlists", playlistsResult.error);
		}

		// Update each playlist's destination status
		const updates = playlistsResult.value.map((playlist) => {
			const shouldBeDestination = data.playlistIds.includes(playlist.id);
			return setPlaylistDestination(playlist.id, shouldBeDestination);
		});

		// Execute all updates in parallel
		const results = await Promise.all(updates);

		// Check for any errors
		const firstError = results.find(Result.isError);
		if (firstError) {
			throw new OnboardingError("update_playlist_destinations", firstError.error);
		}

		return { success: true };
	});
