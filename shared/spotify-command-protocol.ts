export const SPOTIFY_PROTOCOL_VERSION = 1 as const;

export type SpotifyErrorCode =
	| "AUTH_REQUIRED"
	| "TOKEN_EXPIRED"
	| "RATE_LIMITED"
	| "NOT_FOUND"
	| "INVALID_PARAMS"
	| "UNSUPPORTED_OPERATION"
	| "UPSTREAM_ERROR"
	| "UNKNOWN_HASH"
	| "NETWORK_ERROR";

export type CommandResponseOk<T = unknown> = {
	ok: true;
	data: T;
	commandId: string;
};

export type CommandResponseError = {
	ok: false;
	errorCode: SpotifyErrorCode;
	message: string;
	retryable: boolean;
	commandId: string;
};

export type CommandResponse<T = unknown> =
	| CommandResponseOk<T>
	| CommandResponseError;

export type AddToPlaylistPayload = {
	playlistUri: string;
	trackUris: string[];
	position?: "BOTTOM_OF_PLAYLIST" | "TOP_OF_PLAYLIST";
};

export type RemoveFromPlaylistPayload = {
	playlistUri: string;
	uids: string[];
};

export type CreatePlaylistPayload = {
	name: string;
	userId: string;
};

export type UpdatePlaylistPayload = {
	playlistId: string;
	name?: string;
	description?: string;
};

export type DeletePlaylistPayload = {
	playlistUri: string;
	userId: string;
};

export type QueryArtistOverviewPayload = {
	artistUri: string;
	locale?: string;
};

export type SpotifyCommandMap = {
	addToPlaylist: AddToPlaylistPayload;
	removeFromPlaylist: RemoveFromPlaylistPayload;
	createPlaylist: CreatePlaylistPayload;
	updatePlaylist: UpdatePlaylistPayload;
	deletePlaylist: DeletePlaylistPayload;
	queryArtistOverview: QueryArtistOverviewPayload;
};

export type SpotifyCommandName = keyof SpotifyCommandMap;

export type SpotifyCommand = {
	[K in SpotifyCommandName]: {
		type: "SPOTIFY_COMMAND";
		command: K;
		payload: SpotifyCommandMap[K];
		commandId: string;
		protocolVersion?: number;
	};
}[SpotifyCommandName];

type ParseResult<T> =
	| { ok: true; value: T }
	| { ok: false; error: string };

const COMMAND_NAMES: SpotifyCommandName[] = [
	"addToPlaylist",
	"removeFromPlaylist",
	"createPlaylist",
	"updatePlaylist",
	"deletePlaylist",
	"queryArtistOverview",
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOptionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === "string";
}

function isOptionalPlaylistPosition(
	value: unknown,
): value is AddToPlaylistPayload["position"] {
	return (
		value === undefined ||
		value === "BOTTOM_OF_PLAYLIST" ||
		value === "TOP_OF_PLAYLIST"
	);
}

function isSpotifyCommandName(value: unknown): value is SpotifyCommandName {
	return typeof value === "string" && COMMAND_NAMES.includes(value as SpotifyCommandName);
}

const payloadValidators: {
	[K in SpotifyCommandName]: (payload: unknown) => payload is SpotifyCommandMap[K];
} = {
	addToPlaylist: (payload): payload is AddToPlaylistPayload => {
		if (!isRecord(payload)) return false;
		return (
			typeof payload.playlistUri === "string" &&
			isStringArray(payload.trackUris) &&
			isOptionalPlaylistPosition(payload.position)
		);
	},
	removeFromPlaylist: (payload): payload is RemoveFromPlaylistPayload => {
		if (!isRecord(payload)) return false;
		return (
			typeof payload.playlistUri === "string" && isStringArray(payload.uids)
		);
	},
	createPlaylist: (payload): payload is CreatePlaylistPayload => {
		if (!isRecord(payload)) return false;
		return typeof payload.name === "string" && typeof payload.userId === "string";
	},
	updatePlaylist: (payload): payload is UpdatePlaylistPayload => {
		if (!isRecord(payload)) return false;
		return (
			typeof payload.playlistId === "string" &&
			isOptionalString(payload.name) &&
			isOptionalString(payload.description)
		);
	},
	deletePlaylist: (payload): payload is DeletePlaylistPayload => {
		if (!isRecord(payload)) return false;
		return (
			typeof payload.playlistUri === "string" &&
			typeof payload.userId === "string"
		);
	},
	queryArtistOverview: (payload): payload is QueryArtistOverviewPayload => {
		if (!isRecord(payload)) return false;
		return (
			typeof payload.artistUri === "string" && isOptionalString(payload.locale)
		);
	},
};

export function createSpotifyCommand<K extends SpotifyCommandName>(args: {
	command: K;
	payload: SpotifyCommandMap[K];
	commandId: string;
	protocolVersion?: number;
}): Extract<SpotifyCommand, { command: K }> {
	return {
		type: "SPOTIFY_COMMAND",
		command: args.command,
		payload: args.payload,
		commandId: args.commandId,
		protocolVersion: args.protocolVersion,
	} as Extract<SpotifyCommand, { command: K }>;
}

export function parseSpotifyCommand(input: unknown): ParseResult<SpotifyCommand> {
	if (!isRecord(input)) {
		return { ok: false, error: "Command must be an object" };
	}

	if (input.type !== "SPOTIFY_COMMAND") {
		return { ok: false, error: "Invalid command type" };
	}

	if (!isSpotifyCommandName(input.command)) {
		return { ok: false, error: "Unsupported command" };
	}

	if (typeof input.commandId !== "string" || input.commandId.length === 0) {
		return { ok: false, error: "commandId is required" };
	}

	if (
		input.protocolVersion !== undefined &&
		typeof input.protocolVersion !== "number"
	) {
		return { ok: false, error: "protocolVersion must be a number when provided" };
	}

	const validatePayload = payloadValidators[input.command];
	if (!validatePayload(input.payload)) {
		return {
			ok: false,
			error: `Invalid payload for command: ${input.command}`,
		};
	}

	return { ok: true, value: input as SpotifyCommand };
}

export function isSpotifyCommand(input: unknown): input is SpotifyCommand {
	return parseSpotifyCommand(input).ok;
}
