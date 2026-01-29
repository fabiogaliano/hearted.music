import type { PhaseJobIds } from "@/lib/jobs/progress/types";
import type { LibrarySummary } from "@/lib/server/onboarding.server";

/**
 * Statistics from sync operation, passed through router state.
 */
export interface SyncStats {
	songs: number;
	playlists: number;
}

/**
 * Extend TanStack Router's HistoryState with onboarding-specific properties.
 * These are passed via location.state for ephemeral navigation data.
 */
declare module "@tanstack/react-router" {
	interface HistoryState {
		phaseJobIds?: PhaseJobIds;
		theme?: string;
		syncStats?: SyncStats;
		/** Discovery result from ConnectingStep, passed to SyncingStep */
		librarySummary?: LibrarySummary;
	}
}
