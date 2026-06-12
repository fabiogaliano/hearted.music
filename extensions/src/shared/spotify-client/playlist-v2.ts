import {
	recordSpotifyRateLimit,
	runSpotifyRequest,
} from "../spotify-request-policy";
import type {
	PlaylistV2ChangesResponse,
	PlaylistV2CreateResponse,
} from "./responses.types";
import type {
	CreatePlaylistResult,
	DeletePlaylistResult,
	UpdatePlaylistResult,
} from "./types";

const PRIMARY_HOST = "spclient.wg.spotify.com";
const FALLBACK_HOST = "gew4-spclient.spotify.com";
const DEFAULT_RETRY_AFTER_SECONDS = 5;

let resolvedHost: string | null = null;
let resolvedAt = 0;
const HOST_TTL_MS = 5 * 60 * 1000;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveSpClientHost(): Promise<string> {
	if (resolvedHost && Date.now() - resolvedAt < HOST_TTL_MS)
		return resolvedHost;

	try {
		const res = await runSpotifyRequest(() =>
			fetch(`https://${PRIMARY_HOST}/`, { method: "HEAD" }),
		);
		void res.body?.cancel();
		resolvedHost = PRIMARY_HOST;
		resolvedAt = Date.now();
		return resolvedHost;
	} catch {
		// Network failure on primary — try fallback
	}

	try {
		const res = await runSpotifyRequest(() =>
			fetch(`https://${FALLBACK_HOST}/`, { method: "HEAD" }),
		);
		void res.body?.cancel();
		resolvedHost = FALLBACK_HOST;
		resolvedAt = Date.now();
		return resolvedHost;
	} catch {
		// Both failed — default to primary and let the actual request surface the error
		resolvedHost = PRIMARY_HOST;
		resolvedAt = Date.now();
		return resolvedHost;
	}
}

async function playlistV2Fetch<T>(
	token: string,
	path: string,
	body: Record<string, unknown>,
	retries = 3,
): Promise<T> {
	const host = await resolveSpClientHost();
	const url = `https://${host}${path}`;

	let res: Response;
	try {
		res = await runSpotifyRequest(() =>
			fetch(url, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify(body),
			}),
		);
	} catch (err) {
		if (host === PRIMARY_HOST) {
			console.log(`[hearted.] Primary spclient failed, trying fallback`);
			resolvedHost = FALLBACK_HOST;
			return playlistV2Fetch<T>(token, path, body, retries);
		}
		throw err;
	}

	if (res.status === 429) {
		const retryAfter = Number(res.headers.get("Retry-After"));
		const retryAfterSeconds =
			Number.isFinite(retryAfter) && retryAfter > 0
				? retryAfter
				: DEFAULT_RETRY_AFTER_SECONDS;
		recordSpotifyRateLimit(retryAfterSeconds);
		if (retries <= 0) {
			throw new Error(`Spotify rate limit: max retries exceeded for ${path}`);
		}
		console.log(`[hearted.] Rate limited, retrying in ${retryAfterSeconds}s`);
		await delay(retryAfterSeconds * 1000);
		return playlistV2Fetch<T>(token, path, body, retries - 1);
	}

	if (!res.ok) {
		const bodyText = await res.text().catch(() => "");
		const truncated =
			bodyText.length > 500 ? `${bodyText.slice(0, 500)}…` : bodyText;
		throw new Error(
			`Playlist v2 API error: ${res.status} ${path}${truncated ? ` — ${truncated}` : ""}`,
		);
	}

	return res.json() as T;
}

export async function createPlaylist(
	token: string,
	name: string,
	userId: string,
): Promise<CreatePlaylistResult> {
	const created = await playlistV2Fetch<PlaylistV2CreateResponse>(
		token,
		"/playlist/v2/playlist",
		{
			ops: [
				{
					kind: "UPDATE_LIST_ATTRIBUTES",
					updateListAttributes: {
						newAttributes: { values: { name } },
					},
				},
			],
		},
	);

	await playlistV2Fetch<PlaylistV2ChangesResponse>(
		token,
		`/playlist/v2/user/${userId}/rootlist/changes`,
		{
			deltas: [
				{
					ops: [
						{
							kind: "ADD",
							add: {
								items: [
									{
										uri: created.uri,
										attributes: {
											timestamp: String(Date.now()),
										},
									},
								],
								addFirst: true,
							},
						},
					],
					info: { source: { client: "WEBPLAYER" } },
				},
			],
		},
	);

	return {
		uri: created.uri,
		revision: created.revision,
	};
}

export async function updatePlaylist(
	token: string,
	playlistId: string,
	attrs: { name?: string; description?: string },
): Promise<UpdatePlaylistResult> {
	const values: Record<string, string> = {};
	if (attrs.name !== undefined) values.name = attrs.name;
	if (attrs.description !== undefined) values.description = attrs.description;

	const result = await playlistV2Fetch<PlaylistV2ChangesResponse>(
		token,
		`/playlist/v2/playlist/${playlistId}/changes`,
		{
			deltas: [
				{
					ops: [
						{
							kind: "UPDATE_LIST_ATTRIBUTES",
							updateListAttributes: {
								newAttributes: { values },
							},
						},
					],
					info: { source: { client: "WEBPLAYER" } },
				},
			],
		},
	);

	return { revision: result.revision };
}

export async function deletePlaylist(
	token: string,
	playlistUri: string,
	userId: string,
): Promise<DeletePlaylistResult> {
	const result = await playlistV2Fetch<PlaylistV2ChangesResponse>(
		token,
		`/playlist/v2/user/${userId}/rootlist/changes`,
		{
			deltas: [
				{
					ops: [
						{
							kind: "REM",
							rem: {
								items: [{ uri: playlistUri }],
								itemsAsKey: true,
							},
						},
					],
					info: { source: { client: "WEBPLAYER" } },
				},
			],
		},
	);

	return { revision: result.revision };
}
