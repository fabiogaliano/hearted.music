import { queryOptions } from "@tanstack/react-query";
import {
	getMatchingSession,
	getSongMatches,
} from "@/lib/server/matching.functions";

export const matchingKeys = {
	all: ["matching"] as const,
	session: (accountId: string) => ["matching", "session", accountId] as const,
	song: (contextId: string, offset: number) =>
		["matching", "song", contextId, offset] as const,
};

export function matchingSessionQueryOptions(accountId: string) {
	return queryOptions({
		queryKey: matchingKeys.session(accountId),
		queryFn: () => getMatchingSession(),
		staleTime: 30 * 60_000,
	});
}

export function songMatchesQueryOptions(contextId: string, offset: number) {
	return queryOptions({
		queryKey: matchingKeys.song(contextId, offset),
		queryFn: () => getSongMatches({ data: { contextId, offset } }),
		staleTime: 30 * 60_000,
	});
}
