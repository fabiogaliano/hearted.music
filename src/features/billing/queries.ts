import { queryOptions } from "@tanstack/react-query";
import { billingKeys } from "@/lib/query-keys";
import { getBillingState } from "@/lib/server/billing.functions";

export function billingStateQueryOptions() {
	return queryOptions({
		queryKey: billingKeys.state,
		queryFn: () => getBillingState(),
	});
}
