import { getHash } from "./hash-registry";

const PATHFINDER_URL = "https://api-partner.spotify.com/pathfinder/v2/query";

export async function queryPathfinder<T>(
	token: string,
	operationName: string,
	variables: Record<string, unknown>,
	retries = 3,
): Promise<T> {
	const sha256Hash = await getHash(operationName);

	const res = await fetch(PATHFINDER_URL, {
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
	});

	if (res.status === 429) {
		if (retries <= 0) {
			throw new Error(
				`Spotify rate limit: max retries exceeded for ${operationName}`,
			);
		}
		const retryAfter = Number(res.headers.get("Retry-After")) || 5;
		console.log(`[hearted.] Rate limited, retrying in ${retryAfter}s`);
		await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
		return queryPathfinder<T>(token, operationName, variables, retries - 1);
	}

	if (!res.ok) {
		throw new Error(`Pathfinder API error: ${res.status} ${operationName}`);
	}

	return res.json() as T;
}
