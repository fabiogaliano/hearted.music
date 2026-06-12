import { getHash } from "./hash-registry";
import {
	recordSpotifyRateLimit,
	runSpotifyRequest,
} from "./spotify-request-policy";

const PATHFINDER_URL = "https://api-partner.spotify.com/pathfinder/v2/query";
const DEFAULT_RETRY_AFTER_SECONDS = 5;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function queryPathfinder<T>(
	token: string,
	operationName: string,
	variables: Record<string, unknown>,
	retries = 3,
): Promise<T> {
	const sha256Hash = await getHash(operationName);

	const res = await runSpotifyRequest(() =>
		fetch(PATHFINDER_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				variables,
				operationName,
				extensions: { persistedQuery: { version: 1, sha256Hash } },
			}),
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
				`Spotify rate limit: max retries exceeded for ${operationName}`,
			);
		}
		console.log(`[hearted.] Rate limited, retrying in ${retryAfterSeconds}s`);
		await delay(retryAfterSeconds * 1000);
		return queryPathfinder<T>(token, operationName, variables, retries - 1);
	}

	if (!res.ok) {
		throw new Error(`Pathfinder API error: ${res.status} ${operationName}`);
	}

	const json = await res.json();
	if (!json?.data) {
		throw new Error(
			`Pathfinder response missing data envelope for ${operationName}`,
		);
	}
	return json as T;
}
