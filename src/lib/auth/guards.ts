/**
 * Route guards for TanStack Router beforeLoad.
 *
 * These throw TanStack redirect() for use in route guards.
 * For server functions, use requireSession() from session.ts instead.
 */

import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getSession, type Session } from "./session";

type AuthCheckResult =
	| { status: "unauthenticated" }
	| { status: "authenticated"; session: Session };

/**
 * Server function to check auth status.
 * Validates session cookie presence.
 */
export const checkAuth = createServerFn({ method: "GET" }).handler(
	async (): Promise<AuthCheckResult> => {
		const request = getRequest();
		const session = getSession(request);

		if (!session) {
			return { status: "unauthenticated" };
		}

		return { status: "authenticated", session };
	},
);

/**
 * Require authentication in a route's beforeLoad.
 * Returns the session if authenticated, throws redirect otherwise.
 *
 * Usage in _authenticated.tsx layout:
 * ```ts
 * beforeLoad: async () => {
 *   const session = await requireAuth();
 *   return { session };
 * }
 * ```
 */
export async function requireAuth(): Promise<Session> {
	const result = await checkAuth();

	if (result.status === "unauthenticated") {
		throw redirect({ to: "/" });
	}

	return result.session;
}
