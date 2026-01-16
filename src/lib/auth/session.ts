/**
 * Session management for authenticated users.
 *
 * Sessions are stored as account IDs in HTTP-only cookies.
 * The actual tokens are stored server-side in Supabase.
 */

import { getSessionCookie } from "./cookies";

export interface Session {
	accountId: string;
}

/**
 * Gets the current session from request cookies.
 * Returns null if not authenticated.
 */
export function getSession(request: Request): Session | null {
	const accountId = getSessionCookie(request);
	if (!accountId) return null;
	return { accountId };
}

/**
 * Requires a valid session, throws redirect if not authenticated.
 * Use in loaders/server functions that need authentication.
 */
export function requireSession(request: Request): Session {
	const session = getSession(request);
	if (!session) {
		throw new Response(null, {
			status: 302,
			headers: { Location: "/auth/spotify" },
		});
	}
	return session;
}
