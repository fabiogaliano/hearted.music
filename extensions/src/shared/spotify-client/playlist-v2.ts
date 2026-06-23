import {
	recordSpotifyRateLimit,
	runSpotifyRequest,
} from "../spotify-request-policy";
import type {
	ImageUploadResponse,
	PlaylistV2ChangesResponse,
	PlaylistV2CreateResponse,
	PlaylistV2RegisterImageResponse,
} from "./responses.types";
import type {
	CreatePlaylistResult,
	DeletePlaylistResult,
	RemovePlaylistCoverResult,
	SetPlaylistVisibilityResult,
	UpdatePlaylistResult,
	UploadPlaylistCoverResult,
} from "./types";

const PRIMARY_HOST = "spclient.wg.spotify.com";
const FALLBACK_HOST = "gew4-spclient.spotify.com";
const IMAGE_UPLOAD_HOST = "image-upload.spotify.com";
// Spotify rejects playlist covers larger than 10MB.
const MAX_COVER_BYTES = 10 * 1024 * 1024;
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

/**
 * Decodes a base64 cover image (with or without a `data:` URL prefix) into raw
 * bytes, enforcing the 10MB ceiling. Messaging carries the image as base64 since
 * binary doesn't survive the chrome.runtime bridge from the web app.
 */
function decodeCoverImage(imageBase64: string): Uint8Array<ArrayBuffer> {
	const base64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
	// Reject early on the encoded size (~4/3 of the raw bytes) before allocating.
	if (Math.floor((base64.length * 3) / 4) > MAX_COVER_BYTES) {
		throw new Error(
			`Cover image too large: exceeds ${MAX_COVER_BYTES} byte (10MB) limit`,
		);
	}

	const binary = atob(base64);
	if (binary.length > MAX_COVER_BYTES) {
		throw new Error(
			`Cover image too large: ${binary.length} bytes exceeds ${MAX_COVER_BYTES} byte (10MB) limit`,
		);
	}

	const buffer = new ArrayBuffer(binary.length);
	const bytes = new Uint8Array(buffer);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/**
 * Step 1 of the cover flow: POST the raw JPEG bytes to the dedicated upload host
 * (not spclient — its own service), which returns a token referencing the bytes.
 */
async function uploadCoverBytes(
	token: string,
	bytes: Uint8Array<ArrayBuffer>,
	retries = 3,
): Promise<ImageUploadResponse> {
	const res = await runSpotifyRequest(() =>
		fetch(`https://${IMAGE_UPLOAD_HOST}/v4/playlist`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "image/jpeg",
				Accept: "application/json",
			},
			body: new Blob([bytes], { type: "image/jpeg" }),
		}),
	);

	if (res.status === 429) {
		const retryAfter = Number(res.headers.get("Retry-After"));
		const retryAfterSeconds =
			Number.isFinite(retryAfter) && retryAfter > 0
				? retryAfter
				: DEFAULT_RETRY_AFTER_SECONDS;
		recordSpotifyRateLimit(retryAfterSeconds);
		if (retries <= 0) {
			throw new Error(
				"Spotify rate limit: max retries exceeded for image upload",
			);
		}
		console.log(`[hearted.] Rate limited, retrying in ${retryAfterSeconds}s`);
		await delay(retryAfterSeconds * 1000);
		return uploadCoverBytes(token, bytes, retries - 1);
	}

	if (!res.ok) {
		const bodyText = await res.text().catch(() => "");
		const truncated =
			bodyText.length > 500 ? `${bodyText.slice(0, 500)}…` : bodyText;
		throw new Error(
			`Image upload error: ${res.status}${truncated ? ` — ${truncated}` : ""}`,
		);
	}

	return res.json() as Promise<ImageUploadResponse>;
}

/**
 * Sets a playlist cover image. Mirrors Spotify's web player: upload bytes →
 * register the upload against the playlist → persist the returned picture id via
 * the same UPDATE_LIST_ATTRIBUTES change used for name/description.
 */
export async function uploadPlaylistCover(
	token: string,
	playlistId: string,
	imageBase64: string,
): Promise<UploadPlaylistCoverResult> {
	const bytes = decodeCoverImage(imageBase64);

	const { uploadToken } = await uploadCoverBytes(token, bytes);

	const { picture } = await playlistV2Fetch<PlaylistV2RegisterImageResponse>(
		token,
		`/playlist/v2/playlist/${playlistId}/register-image`,
		{ uploadToken },
	);

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
								newAttributes: { values: { picture } },
							},
						},
					],
					info: { source: { client: "WEBPLAYER" } },
				},
			],
		},
	);

	return { revision: result.revision, picture };
}

/**
 * Removes a playlist's custom cover, reverting to Spotify's auto-generated art.
 * Uses the `noValue` clear-attribute form (not `picture: ""`) — captured from
 * the web player's own remove-photo flow.
 */
export async function removePlaylistCover(
	token: string,
	playlistId: string,
): Promise<RemovePlaylistCoverResult> {
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
								newAttributes: { values: {}, noValue: ["LIST_PICTURE"] },
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

/**
 * Toggles a playlist's profile visibility (Spotify's "public" flag — whether it
 * shows on your profile and is discoverable, NOT link access control). This is an
 * item attribute on the user's rootlist, so it needs the userId like delete does.
 */
export async function setPlaylistVisibility(
	token: string,
	playlistUri: string,
	userId: string,
	isPublic: boolean,
): Promise<SetPlaylistVisibilityResult> {
	const result = await playlistV2Fetch<PlaylistV2ChangesResponse>(
		token,
		`/playlist/v2/user/${userId}/rootlist/changes`,
		{
			deltas: [
				{
					ops: [
						{
							kind: "UPDATE_ITEM_ATTRIBUTES",
							updateItemAttributes: {
								newAttributes: { values: { public: isPublic } },
								item: { uri: playlistUri },
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
