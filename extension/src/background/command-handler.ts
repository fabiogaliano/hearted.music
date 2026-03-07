import type {
	CommandResponse,
	SpotifyCommand,
	SpotifyCommandMap,
	SpotifyCommandName,
	SpotifyErrorCode,
	SpotifyTokenPayload,
} from "../shared/types";
import { queryArtistOverview } from "../shared/spotify-client/reads";
import {
	addToPlaylist,
	removeFromPlaylist,
} from "../shared/spotify-client/mutations";
import {
	createPlaylist,
	updatePlaylist,
	deletePlaylist,
} from "../shared/spotify-client/playlist-v2";

export type TokenProvider = {
	getCachedToken: () => SpotifyTokenPayload | null;
	setCachedToken: (token: SpotifyTokenPayload) => void;
	isTokenValid: () => boolean;
};

type CommandResultMap = {
	addToPlaylist: Awaited<ReturnType<typeof addToPlaylist>>;
	removeFromPlaylist: Awaited<ReturnType<typeof removeFromPlaylist>>;
	createPlaylist: Awaited<ReturnType<typeof createPlaylist>>;
	updatePlaylist: Awaited<ReturnType<typeof updatePlaylist>>;
	deletePlaylist: Awaited<ReturnType<typeof deletePlaylist>>;
	queryArtistOverview: Awaited<ReturnType<typeof queryArtistOverview>>;
};

type CommandExecutorMap = {
	[K in SpotifyCommandName]: (
		token: string,
		payload: SpotifyCommandMap[K],
	) => Promise<CommandResultMap[K]>;
};

const commandExecutors: CommandExecutorMap = {
	addToPlaylist: async (token, payload) =>
		addToPlaylist(
			token,
			payload.playlistUri,
			payload.trackUris,
			payload.position,
		),
	removeFromPlaylist: async (token, payload) =>
		removeFromPlaylist(token, payload.playlistUri, payload.uids),
	createPlaylist: async (token, payload) =>
		createPlaylist(token, payload.name, payload.userId),
	updatePlaylist: async (token, payload) =>
		updatePlaylist(token, payload.playlistId, {
			name: payload.name,
			description: payload.description,
		}),
	deletePlaylist: async (token, payload) =>
		deletePlaylist(token, payload.playlistUri, payload.userId),
	queryArtistOverview: async (token, payload) =>
		queryArtistOverview(token, payload.artistUri, payload.locale),
};

async function runCommandExecutor<K extends SpotifyCommandName>(
	name: K,
	token: string,
	payload: SpotifyCommandMap[K],
): Promise<CommandResultMap[K]> {
	const execute = commandExecutors[name] as (
		token: string,
		payload: SpotifyCommandMap[K],
	) => Promise<CommandResultMap[K]>;
	return execute(token, payload);
}

function mapErrorToResponse(
	err: unknown,
	commandId: string,
): CommandResponse<never> {
	const message = err instanceof Error ? err.message : "Unknown error";

	if (/rate\s*limit/i.test(message)) {
		return {
			ok: false,
			errorCode: "RATE_LIMITED",
			message,
			retryable: true,
			commandId,
		};
	}

	if (/unknown operation|no hash/i.test(message)) {
		return {
			ok: false,
			errorCode: "UNKNOWN_HASH",
			message,
			retryable: false,
			commandId,
		};
	}

	if (/network error|fetch failed/i.test(message)) {
		return {
			ok: false,
			errorCode: "NETWORK_ERROR",
			message,
			retryable: true,
			commandId,
		};
	}

	const errorCode: SpotifyErrorCode = "UPSTREAM_ERROR";
	return { ok: false, errorCode, message, retryable: false, commandId };
}

async function executeSpotifyCommand(
	command: SpotifyCommand,
	token: string,
): Promise<CommandResponse> {
	const data = await runCommandExecutor(
		command.command as SpotifyCommandName,
		token,
		command.payload as SpotifyCommandMap[SpotifyCommandName],
	);
	return {
		ok: true,
		data,
		commandId: command.commandId,
	};
}

export async function handleSpotifyCommand(
	cmd: SpotifyCommand,
	tokenProvider: TokenProvider,
): Promise<CommandResponse> {
	if (!tokenProvider.getCachedToken()) {
		const { spotifyToken } = await chrome.storage.local.get("spotifyToken");
		if (spotifyToken)
			tokenProvider.setCachedToken(spotifyToken as SpotifyTokenPayload);
	}

	const cachedToken = tokenProvider.getCachedToken();

	if (
		!cachedToken ||
		!tokenProvider.isTokenValid() ||
		cachedToken.isAnonymous
	) {
		return {
			ok: false,
			errorCode: "AUTH_REQUIRED",
			message: "No valid Spotify token",
			retryable: false,
			commandId: cmd.commandId,
		};
	}

	const token = cachedToken.accessToken;
	const commandName = cmd.command as SpotifyCommandName;

	if (!(commandName in commandExecutors)) {
		return {
			ok: false,
			errorCode: "UNSUPPORTED_OPERATION",
			message: `Unknown command: ${String((cmd as { command?: unknown }).command)}`,
			retryable: false,
			commandId: cmd.commandId,
		};
	}

	try {
		return await executeSpotifyCommand(cmd, token);
	} catch (err) {
		return mapErrorToResponse(err, cmd.commandId);
	}
}
