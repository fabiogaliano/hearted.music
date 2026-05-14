/**
 * TanStack Start auth middleware for server functions.
 *
 * Resolves the session + account from the request and injects them
 * into middleware context. Server function handlers access auth via
 * `context.session` and `context.account` instead of calling
 * requireAuthSession() directly.
 *
 * Two variants:
 *   - `authMiddleware`     — requires auth, throws redirect if missing
 *   - `optionalAuthMiddleware` — resolves auth if present, null if not
 */

import { redirect } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";
import { getAuthSession } from "@/lib/platform/auth/auth.server";

/**
 * Requires authentication. Redirects to "/" if not authenticated.
 * Use on all protected server functions.
 */
export const authMiddleware = createMiddleware({ type: "function" }).server(
	async ({ next }) => {
		const authContext = await getAuthSession();

		if (!authContext) {
			throw redirect({ to: "/" });
		}

		return next({
			context: {
				session: authContext.session,
				account: authContext.account,
			},
		});
	},
);
