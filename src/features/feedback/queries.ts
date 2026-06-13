import { queryOptions } from "@tanstack/react-query";
import { getUserJotSignature } from "@/lib/server/userjot.functions";

export function userJotSignatureQueryOptions(accountId: string) {
	return queryOptions({
		queryKey: ["userjot", "signature", accountId],
		queryFn: () => getUserJotSignature(),
		// A pure HMAC of the account ID — stable for the session, never refetch.
		staleTime: Number.POSITIVE_INFINITY,
	});
}
