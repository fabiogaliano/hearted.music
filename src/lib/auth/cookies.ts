/**
 * Cookie helpers for OAuth flow and session management.
 *
 * Uses HTTP-only cookies for security - tokens never touch JavaScript.
 */

const OAUTH_STATE_COOKIE = "oauth_state";
const OAUTH_VERIFIER_COOKIE = "oauth_verifier";
const SESSION_COOKIE = "session_id";

interface CookieOptions {
	httpOnly?: boolean;
	secure?: boolean;
	sameSite?: "Strict" | "Lax" | "None";
	maxAge?: number;
	path?: string;
}

function serializeCookie(
	name: string,
	value: string,
	options: CookieOptions = {},
): string {
	const {
		httpOnly = true,
		secure = process.env.NODE_ENV === "production",
		sameSite = "Lax",
		maxAge,
		path = "/",
	} = options;

	let cookie = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;

	if (httpOnly) cookie += "; HttpOnly";
	if (secure) cookie += "; Secure";
	if (maxAge !== undefined) cookie += `; Max-Age=${maxAge}`;

	return cookie;
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
	if (!cookieHeader) return {};

	return cookieHeader.split(";").reduce(
		(cookies, cookie) => {
			const [name, ...rest] = cookie.trim().split("=");
			if (name) {
				cookies[name] = decodeURIComponent(rest.join("="));
			}
			return cookies;
		},
		{} as Record<string, string>,
	);
}

/**
 * Sets OAuth flow cookies (state + code verifier).
 * These are short-lived and cleared after callback.
 */
export function setOAuthCookies(state: string, codeVerifier: string): string[] {
	const maxAge = 600; // 10 minutes - enough for OAuth flow
	return [
		serializeCookie(OAUTH_STATE_COOKIE, state, { maxAge }),
		serializeCookie(OAUTH_VERIFIER_COOKIE, codeVerifier, { maxAge }),
	];
}

/**
 * Gets OAuth cookies from request.
 */
export function getOAuthCookies(request: Request): {
	state: string | null;
	codeVerifier: string | null;
} {
	const cookies = parseCookies(request.headers.get("Cookie"));
	return {
		state: cookies[OAUTH_STATE_COOKIE] || null,
		codeVerifier: cookies[OAUTH_VERIFIER_COOKIE] || null,
	};
}

/**
 * Clears OAuth cookies after successful callback.
 */
export function clearOAuthCookies(): string[] {
	return [
		serializeCookie(OAUTH_STATE_COOKIE, "", { maxAge: 0 }),
		serializeCookie(OAUTH_VERIFIER_COOKIE, "", { maxAge: 0 }),
	];
}

/**
 * Sets session cookie with account ID.
 */
export function setSessionCookie(accountId: string): string {
	const maxAge = 60 * 60 * 24 * 30; // 30 days
	return serializeCookie(SESSION_COOKIE, accountId, { maxAge });
}

/**
 * Gets session account ID from request.
 */
export function getSessionCookie(request: Request): string | null {
	const cookies = parseCookies(request.headers.get("Cookie"));
	return cookies[SESSION_COOKIE] || null;
}

/**
 * Clears session cookie (logout).
 */
export function clearSessionCookie(): string {
	return serializeCookie(SESSION_COOKIE, "", { maxAge: 0 });
}
