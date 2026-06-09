import type { AnalysisContent } from "@/lib/domains/enrichment/content-analysis/analysis-content";
import type { ThemeColor } from "@/lib/theme/types";

export type WalkthroughSongAnalysis = {
	id: string;
	content: AnalysisContent;
	model: string;
	createdAt: string | null;
};

export type WalkthroughSong = {
	id: string;
	spotifyTrackId: string;
	slug: string;
	name: string;
	artist: string;
	artistId: string | null;
	artistImageUrl: string | null;
	album: string | null;
	albumArtUrl: string | null;
	genres: string[];
	/** Pre-fetched analysis so the walkthrough panel can render immediately */
	analysis: WalkthroughSongAnalysis | null;
};

/**
 * Discriminated union over the onboarding lifecycle.
 *
 * Walkthrough variants carry their required payload inline (`song`) so the
 * type system forbids `{ status: "song-walkthrough", song: null }` — the
 * shape that used to cause the onboarding redirect loop. Make illegal states
 * unrepresentable: preconditions live in the type, not in scattered runtime
 * guards.
 */
export type OnboardingSession =
	| { status: "welcome" }
	| { status: "pick-color" }
	| { status: "install-extension" }
	| { status: "syncing" }
	| { status: "claim-handle" }
	| { status: "flag-playlists" }
	| { status: "pick-demo-song" }
	| { status: "song-walkthrough"; song: WalkthroughSong }
	| { status: "match-walkthrough"; song: WalkthroughSong }
	| { status: "plan-selection" }
	| { status: "complete" };

export type OnboardingAuthPayload = {
	session: OnboardingSession;
	theme: ThemeColor | null;
};

/** Broad categorization used by layout shells and UI branches. */
export type OnboardingMode = "steps" | "walkthrough" | "complete";

export function sessionMode(session: OnboardingSession): OnboardingMode {
	switch (session.status) {
		case "complete":
			return "complete";
		case "song-walkthrough":
		case "match-walkthrough":
			return "walkthrough";
		default:
			return "steps";
	}
}
