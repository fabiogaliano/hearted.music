import type {
	CommandResponse,
	SpotifyErrorCode,
} from "../../../shared/spotify-command-protocol";
import type { AcknowledgedResult } from "./playlist-write-acknowledgement";

export type SpotifyActionOutcome =
	| { status: "success" }
	| { status: "reconnect-required" }
	| { status: "extension-unavailable" }
	| { status: "error"; errorCode: SpotifyErrorCode };

export function outcomeFromCommandResponse(
	r: CommandResponse<unknown>,
): SpotifyActionOutcome {
	if (r.ok) return { status: "success" };
	if (r.errorCode === "AUTH_REQUIRED" || r.errorCode === "TOKEN_EXPIRED") {
		return { status: "reconnect-required" };
	}
	if (r.errorCode === "NETWORK_ERROR") {
		return { status: "extension-unavailable" };
	}
	return { status: "error", errorCode: r.errorCode };
}

export function outcomeFromAcknowledgedResult<T>(
	r: AcknowledgedResult<T>,
): SpotifyActionOutcome {
	if (r.ok) return { status: "success" };
	return outcomeFromCommandResponse(r.commandResponse);
}
