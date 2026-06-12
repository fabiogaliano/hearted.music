import { queryOptions } from "@tanstack/react-query";
import {
	getMatchingSession,
	getSongMatches,
} from "@/lib/server/matching.functions";

export const matchingKeys = {
	all: ["matching"] as const,
	session: (accountId: string) => ["matching", "session", accountId] as const,
	song: (snapshotId: string, songId: string) =>
		["matching", "song", snapshotId, songId] as const,
};

export function matchingSessionQueryOptions(accountId: string) {
	return queryOptions({
		queryKey: matchingKeys.session(accountId),
		queryFn: () => getMatchingSession(),
		staleTime: 30 * 60_000,
	});
}

export function songMatchesQueryOptions(snapshotId: string, songId: string) {
	return queryOptions({
		queryKey: matchingKeys.song(snapshotId, songId),
		queryFn: () => getSongMatches({ data: { snapshotId, songId } }),
		staleTime: 30 * 60_000,
	});
}
