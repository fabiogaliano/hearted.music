import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import {
	requestErrorMiddleware,
	serverFnErrorMiddleware,
} from "@/lib/observability/server-error-middleware";
import { authRequestMiddleware } from "@/lib/platform/auth/auth-request-state";
import { guardServerFnFetch } from "@/lib/platform/server-fn/guarded-fetch";

// Defining src/start.ts opts out of the CSRF middleware Start installs by
// default, so we re-add it explicitly. It validates Sec-Fetch-Site/Origin/Referer
// on serverFn requests only (handlerType filter), leaving SSR document/loader
// requests untouched. SameSite=lax cookies remain the first line of defense;
// this adds same-site/sibling-origin coverage that SameSite cannot express.
const csrfMiddleware = createCsrfMiddleware({
	filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
	// First so it also sees failures from the middleware after it.
	requestMiddleware: [
		requestErrorMiddleware,
		csrfMiddleware,
		authRequestMiddleware,
	],
	functionMiddleware: [serverFnErrorMiddleware],
	// Client-only (SSR calls server fns in-process). Rejects transport-level
	// error pages that Start's RPC client would otherwise resolve to undefined.
	serverFns: {
		fetch: guardServerFnFetch((input, init) => fetch(input, init)),
	},
}));
