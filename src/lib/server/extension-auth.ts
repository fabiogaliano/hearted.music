/**
 * Shared account resolution for extension API routes: Better Auth session cookie
 * first, then the extension's Bearer API token. Mirrors the inline guard the
 * sync/status and artists/check routes already use. Returns null when neither
 * authenticates the caller.
 */

import { Result } from "better-result";
import { getAuthSession } from "@/lib/platform/auth/auth.server";
import { validateExtensionApiToken } from "@/lib/platform/auth/extension-api-tokens";

export async function resolveExtensionAccountId(
	request: Request,
): Promise<string | null> {
	const authContext = await getAuthSession();
	if (authContext) {
		return authContext.session.accountId;
	}

	const authHeader = request.headers.get("Authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		return null;
	}

	const tokenResult = await validateExtensionApiToken(authHeader.slice(7));
	if (Result.isOk(tokenResult) && tokenResult.value) {
		return tokenResult.value;
	}

	return null;
}
