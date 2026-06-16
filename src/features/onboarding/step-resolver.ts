import type { OnboardingSession } from "@/lib/domains/library/accounts/onboarding-session";

export type AllowedPath =
	| "/onboarding"
	| "/playlists"
	| "/liked-songs"
	| "/match"
	| "/dashboard";

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
		case "song-walkthrough":
			return { allowedPath: "/liked-songs" };
		case "match-walkthrough":
			return { allowedPath: "/match" };
		// Previewed on the real /playlists screen (preview chrome), mirroring the
		// song/match walkthroughs rather than rendering inside the orchestrator.
		case "flag-playlists":
			return { allowedPath: "/playlists" };
		case "complete":
			return { allowedPath: "/dashboard" };
		case "welcome":
		case "pick-color":
		case "install-extension":
		case "syncing":
		case "claim-handle":
		case "pick-demo-song":
		case "plan-selection":
			return { allowedPath: "/onboarding" };
	}
}

export function isPathAllowed(
	pathname: string,
	allowedPath: AllowedPath,
): boolean {
	// Prefix-match so child routes of an allowed path stay allowed — e.g. the
	// /playlists preview opens detail panels at /playlists/$playlistRef. Other
	// allowed paths have no children today, so this is a no-op for them.
	return pathname === allowedPath || pathname.startsWith(`${allowedPath}/`);
}
