import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import * as TanstackQuery from "./integrations/tanstack-query/root-provider";

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
	const rqContext = TanstackQuery.getContext();

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

	return router;
};
