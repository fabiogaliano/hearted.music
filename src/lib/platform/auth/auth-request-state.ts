import { createMiddleware, getGlobalStartContext } from "@tanstack/react-start";
import type { AuthContext } from "@/lib/platform/auth/auth-types";

/** Memoises the session lookup so one request reads it at most once. */
export interface AuthRequestState {
	getCachedSession(): Promise<AuthContext | null> | undefined;
	cacheSession(
		sessionPromise: Promise<AuthContext | null>,
	): Promise<AuthContext | null>;
}

function createAuthRequestState(): AuthRequestState {
	let sessionPromise: Promise<AuthContext | null> | undefined;

	return {
		getCachedSession() {
			return sessionPromise;
		},
		cacheSession(promise) {
			sessionPromise ??= promise;
			return sessionPromise;
		},
	};
}

export const authRequestMiddleware = createMiddleware().server(({ next }) =>
	next({ context: { authRequest: createAuthRequestState() } }),
);

function hasAuthRequestContext(
	context: unknown,
): context is { authRequest: AuthRequestState } {
	return (
		typeof context === "object" &&
		context !== null &&
		"authRequest" in context &&
		context.authRequest !== undefined
	);
}

export function getAuthRequestState(): AuthRequestState {
	const context: unknown = getGlobalStartContext();

	if (!hasAuthRequestContext(context)) {
		throw new Error(
			"Auth request context unavailable. Add authRequestMiddleware to src/start.ts and call auth helpers only within the TanStack Start request lifecycle.",
		);
	}

	return context.authRequest;
}
