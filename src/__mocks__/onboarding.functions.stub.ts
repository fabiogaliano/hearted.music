/**
 * Ladle stub for @/lib/server/onboarding.functions.
 *
 * Re-exports types/interfaces verbatim and replaces server function callables
 * with async rejects so components fall to their error/unavailable states.
 */

import type { ThemeColor } from "@/lib/theme/types";

// ── Types (re-exported as-is) ──────────────────────────────────────────

export interface OnboardingPlaylist {
	id: string;
	name: string;
	description: string | null;
	imageUrl: string | null;
	songCount: number | null;
	isTarget: boolean;
}

export interface SyncStats {
	songs: number;
	playlists: number;
}

export type ReadyCopyVariant = "free" | "pack" | "unlimited";

export interface OnboardingData {
	theme: ThemeColor | null;
	playlists: OnboardingPlaylist[];
	currentStep: string;
	isComplete: boolean;
	phaseJobIds: Record<string, string> | null;
	syncStats: SyncStats | null;
	readyCopyVariant: ReadyCopyVariant;
	landingSongs: Array<{
		id: number;
		spotifyTrackId: string;
		name: string;
		artist: string;
		album: string;
		albumArtUrl: string;
		artistImageUrl?: string;
		spotifyArtistId: string;
		genres: string[];
		detailPath: string;
	}>;
	walkthroughSong: {
		id: string;
		spotifyTrackId: string;
		slug: string;
		name: string;
		artist: string;
		album: string | null;
		albumArtUrl: string | null;
	} | null;
}

export interface DemoMatchPlaylist {
	id: string;
	name: string;
	description: string | null;
	songCount: number | null;
	score: number;
}

export type DemoMatchResult =
	| { status: "ready"; matches: DemoMatchPlaylist[]; isDemo: boolean }
	| { status: "pending" }
	| { status: "unavailable" };

// ── Stub callables ─────────────────────────────────────────────────────

const reject = () =>
	Promise.reject(new Error("[Ladle stub] server function unavailable"));

export const getOnboardingData =
	reject as unknown as () => Promise<OnboardingData>;
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
export const savePlaylistTargets = reject as unknown as (opts: {
	data: { playlistIds: string[] };
}) => Promise<void>;

export const getDemoSongMatches =
	reject as unknown as () => Promise<DemoMatchResult>;
export const saveDemoSongSelection = reject as unknown as (opts: {
	data: { spotifyTrackId: string };
}) => Promise<{ success: true }>;
