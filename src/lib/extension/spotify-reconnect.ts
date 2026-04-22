import type { CommandResponse } from "../../../shared/spotify-command-protocol";

export function requiresSpotifyReconnect(
	response: CommandResponse<unknown>,
): boolean {
	if (response.ok) return false;
	return (
		response.errorCode === "AUTH_REQUIRED" ||
		response.errorCode === "TOKEN_EXPIRED"
	);
}
