/**
 * UserJot feedback widget identity signing.
 *
 * Secure mode ("Require Signed Tokens") verifies an HMAC-SHA256 of the user ID
 * keyed by the workspace secret. The secret is server-only, so the signature is
 * computed here and handed to the browser SDK's identify() call. Returns null
 * when no secret is configured — the widget then identifies anonymously, which
 * is valid as long as secure mode is off in the UserJot dashboard.
 */

import { createServerFn } from "@tanstack/react-start";
import { env } from "@/env";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(message),
	);
	return Array.from(new Uint8Array(signature))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export const getUserJotSignature = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<string | null> => {
		const secret = env.USERJOT_IDENTITY_SECRET;
		if (!secret) return null;
		// UserJot signs the user ID only; the id passed to identify() must match.
		return hmacSha256Hex(secret, context.session.accountId);
	});
