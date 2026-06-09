import type { OnboardingSession } from "@/lib/domains/library/accounts/onboarding-session";

export type AllowedPath =
	| "/onboarding"
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
		case "complete":
			return { allowedPath: "/dashboard" };
		case "welcome":
		case "pick-color":
		case "install-extension":
		case "syncing":
		case "claim-handle":
		case "flag-playlists":
		case "pick-demo-song":
		case "plan-selection":
			return { allowedPath: "/onboarding" };
	}
}

export function isPathAllowed(
	pathname: string,
	allowedPath: AllowedPath,
): boolean {
	return pathname === allowedPath;
}
