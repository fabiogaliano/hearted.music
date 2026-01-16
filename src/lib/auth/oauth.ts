/**
 * PKCE OAuth helpers for Spotify authentication.
 *
 * PKCE (Proof Key for Code Exchange) prevents authorization code interception attacks
 * by using a code verifier/challenge pair instead of relying solely on client secrets.
 */

/**
 * Generates a cryptographically random code verifier for PKCE.
 * The verifier is a high-entropy random string (43-128 characters).
 */
export function generateCodeVerifier(): string {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return base64UrlEncode(array);
}

/**
 * Generates a code challenge from the verifier using SHA-256.
 * The challenge is sent to Spotify, the verifier stays server-side.
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const digest = await crypto.subtle.digest("SHA-256", data);
	return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Generates a random state parameter to prevent CSRF attacks.
 */
export function generateState(): string {
	const array = new Uint8Array(16);
	crypto.getRandomValues(array);
	return base64UrlEncode(array);
}

/**
 * Base64URL encoding (RFC 4648) - safe for URLs without escaping.
 */
function base64UrlEncode(buffer: Uint8Array): string {
	const base64 = btoa(String.fromCharCode(...buffer));
	return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
