import { QueryClient } from "@tanstack/react-query";

export function getContext() {
	// The account-events SSE stream pushes invalidations for everything that
	// changes server-side (jobs, enrichment, matches, billing), so focus and
	// remount refetches would only duplicate frames the stream already
	// delivered. staleTime lets loader-primed caches be trusted on mount;
	// invalidateQueries from stream events ignores staleTime, so pushed
	// updates still refetch immediately.
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				refetchOnWindowFocus: false,
				staleTime: 30_000,
			},
		},
	});
	return {
		queryClient,
	};
}
