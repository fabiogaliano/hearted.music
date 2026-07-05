import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getContext } from "./integrations/tanstack-query/root-provider";
import { markNavigated } from "./lib/navigation/session-navigation";
import { initSentry } from "./lib/observability/sentry";

import { routeTree } from "./routeTree.gen";

const getSSROptions = createIsomorphicFn().server(() => {
	const array = new Uint8Array(16);
	crypto.getRandomValues(array);
	const nonce = Array.from(array, (b) => b.toString(16).padStart(2, "0")).join(
		"",
	);
	return { nonce };
});

export const getRouter = () => {
	const rqContext = getContext();

	const router = createRouter({
		routeTree,
		context: {
			...rqContext,
		},
		defaultPreload: "intent",
		ssr: getSSROptions(),
	});

	setupRouterSsrQueryIntegration({
		router,
		queryClient: rqContext.queryClient,
	});

	if (!router.isServer) {
		void initSentry(router);

		// The initial location is already set before we subscribe, so this fires
		// only on the first real in-app navigation — never for a direct landing.
		const unsubscribe = router.history.subscribe(() => {
			markNavigated();
			unsubscribe();
		});
	}

	return router;
};
