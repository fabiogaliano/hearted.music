/**
 * Extension Token API Route
 *
 * POST /api/extension/token — Generate a new API token for the extension
 * DELETE /api/extension/token — Revoke all tokens for the authenticated account
 *
 * Auth: Better Auth session cookie (required for both endpoints)
 */

import { createFileRoute } from "@tanstack/react-router";
import { isCsrfRequestAllowed } from "@tanstack/react-start";
import { Result } from "better-result";
import { requireAuthSession } from "@/lib/platform/auth/auth.server";
import {
	createExtensionApiToken,
	revokeExtensionApiTokensForAccount,
} from "@/lib/platform/auth/extension-api-tokens";

// SameSite=lax already withholds the session cookie on cross-site requests, but
// this REST file route is handlerType "router", so the serverFn CSRF middleware
// (src/start.ts) never sees it. Re-run the framework's own origin check here so
// these credential-minting endpoints get the same same-site/sibling-origin
// coverage as server functions. The cast supplies the only field the validator
// reads (ctx.request); RequestServerOptions isn't exported from the package root.
async function rejectCrossSiteRequest(
	request: Request,
): Promise<Response | null> {
	const allowed = await isCsrfRequestAllowed({}, { request } as Parameters<
		typeof isCsrfRequestAllowed
	>[1]);
	return allowed ? null : new Response("Forbidden", { status: 403 });
}

export const Route = createFileRoute("/api/extension/token")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const blocked = await rejectCrossSiteRequest(request);
				if (blocked) return blocked;

				const authContext = await requireAuthSession();
				const { accountId } = authContext.session;

				const tokenResult = await createExtensionApiToken(accountId);
				if (Result.isError(tokenResult)) {
					return Response.json(
						{ error: "Failed to generate token" },
						{ status: 500 },
					);
				}

				return Response.json({ token: tokenResult.value });
			},

			DELETE: async ({ request }) => {
				const blocked = await rejectCrossSiteRequest(request);
				if (blocked) return blocked;

				const authContext = await requireAuthSession();
				const { accountId } = authContext.session;

				const revokeResult =
					await revokeExtensionApiTokensForAccount(accountId);
				if (Result.isError(revokeResult)) {
					return Response.json(
						{ error: "Failed to revoke tokens" },
						{ status: 500 },
					);
				}

				return Response.json({ ok: true });
			},
		},
	},
});
