/**
 * Route guards for TanStack Router beforeLoad.
 *
 * These throw TanStack redirect() for use in route guards.
 * For server functions, use requireSession() from session.ts instead.
 */

import { Result } from "better-result";
import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAccountById, type Account } from "@/lib/data/accounts";
import { getSession, type Session } from "./session";

type AuthCheckResult =
	| { status: "unauthenticated" }
	| { status: "authenticated"; session: Session; account: Account | null };

/**
 * Server function to check auth status.
 * Validates session cookie and fetches account data.
 */
export const checkAuth = createServerFn({ method: "GET" }).handler(
	async (): Promise<AuthCheckResult> => {
		const request = getRequest();
		const session = getSession(request);

		if (!session) {
			return { status: "unauthenticated" };
		}

		const accountResult = await getAccountById(session.accountId);
		const account = Result.isOk(accountResult) ? accountResult.value : null;

		return { status: "authenticated", session, account };
	},
);

/**
 * Require authentication in a route's beforeLoad.
 * Returns session and account if authenticated, throws redirect otherwise.
 *
 * Usage in _authenticated.tsx layout:
 * ```ts
 * beforeLoad: async () => {
 *   const { session, account } = await requireAuth();
 *   return { session, account };
 * }
 * ```
 */
export async function requireAuth(): Promise<{
	session: Session;
	account: Account | null;
}> {
	const result = await checkAuth();

	if (result.status === "unauthenticated") {
		throw redirect({ to: "/" });
	}

	return { session: result.session, account: result.account };
}
