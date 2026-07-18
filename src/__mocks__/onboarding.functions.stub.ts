/**
 * Ladle stub for @/lib/server/onboarding.functions.
 *
 * Type-only imports the real module's result types (erased before module
 * resolution, so the real module's server graph never reaches the Ladle
 * bundle) and replaces server function callables with async rejects so
 * components fall to their error/unavailable states.
 */

import type {
	OnboardingAuthPayload,
	OnboardingSession,
	WalkthroughSong,
} from "@/lib/domains/library/accounts/onboarding-session";
import type {
	OnboardingData,
	OnboardingPlaylist,
	ReadyCopyVariant,
	SyncStats,
} from "@/lib/server/onboarding.functions";
import type { ThemeColor } from "@/lib/theme/types";

// Re-export shared session + page-data types so downstream ladle stories can
// consume them through this stub without knowing the domain module path.
export type {
	OnboardingAuthPayload,
	OnboardingData,
	OnboardingPlaylist,
	OnboardingSession,
	ReadyCopyVariant,
	SyncStats,
	WalkthroughSong,
};

// ── Stub callables ─────────────────────────────────────────────────────

const reject = () =>
	Promise.reject(new Error("[Ladle stub] server function unavailable"));

export const getOnboardingData =
	reject as unknown as () => Promise<OnboardingData>;
export const getOnboardingSession =
	reject as unknown as () => Promise<OnboardingAuthPayload>;
export const saveThemePreference = reject as unknown as (opts: {
	data: { theme: ThemeColor };
}) => Promise<void>;
export const getLibrarySummary = reject as unknown as () => Promise<SyncStats>;
export const executeSync = reject as unknown as () => Promise<void>;
export const resetSyncJobs = reject as unknown as () => Promise<void>;
export const saveOnboardingStep = reject as unknown as (opts: {
	data: { step: string };
}) => Promise<void>;
export const markOnboardingComplete = reject as unknown as () => Promise<void>;
export const saveDemoSongSelection = reject as unknown as (opts: {
	data: { spotifyTrackId: string };
}) => Promise<{ success: true }>;

export const commitDemoSongAndEnterWalkthrough = reject as unknown as (opts: {
	data: { spotifyTrackId: string };
}) => Promise<OnboardingAuthPayload>;

export const getWalkthroughCompanionSongs = reject as unknown as () => Promise<
	WalkthroughSong[]
>;
