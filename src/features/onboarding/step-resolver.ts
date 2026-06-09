import type { AnalysisContent } from "@/lib/domains/enrichment/content-analysis/analysis-content";

type WalkthroughSongAnalysis = {
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

type AllowedPath = "/onboarding" | "/liked-songs" | "/match";

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
	| { status: "flag-playlists" }
	| { status: "pick-demo-song" }
	| { status: "song-walkthrough"; song: WalkthroughSong }
	| { status: "match-walkthrough"; song: WalkthroughSong }
	| { status: "plan-selection" }
	| { status: "complete" };

/** Broad categorization used by layout shells and UI branches. */
type OnboardingMode = "steps" | "walkthrough" | "complete";

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

/**
 * Route resolution from the canonical session.
 *
 * Because the DU already guarantees walkthrough variants carry their song,
 * this function can't fail into a broken intermediate state — callers don't
 * need separate precondition checks.
 */
export function resolveSession(session: OnboardingSession): {
	allowedPath: AllowedPath;
} {
	switch (session.status) {
		case "complete":
		case "song-walkthrough":
			return { allowedPath: "/liked-songs" };
		case "match-walkthrough":
			return { allowedPath: "/match" };
		default:
			return { allowedPath: "/onboarding" };
	}
}

export function isPathAllowed(
	pathname: string,
	allowedPath: AllowedPath,
): boolean {
	return pathname === allowedPath;
}
