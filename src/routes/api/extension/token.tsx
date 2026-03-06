/**
 * Extension Token API Route
 *
 * POST /api/extension/token — Generate a new API token for the extension
 * DELETE /api/extension/token — Revoke all tokens for the authenticated account
 *
 * Auth: Better Auth session cookie (required for both endpoints)
 */

import { createFileRoute } from "@tanstack/react-router";
import { Result } from "better-result";
import { requireAuthSession } from "@/lib/auth.server";
import {
	generateApiToken,
	revokeAllTokensForAccount,
} from "@/lib/data/api-tokens";

export const Route = createFileRoute("/api/extension/token")({
	server: {
		handlers: {
			POST: async () => {
				const authContext = await requireAuthSession();
				const { accountId } = authContext.session;

				const tokenResult = await generateApiToken(accountId);
				if (Result.isError(tokenResult)) {
					return Response.json(
						{ error: "Failed to generate token" },
						{ status: 500 },
					);
				}

				return Response.json({ token: tokenResult.value });
			},

			DELETE: async () => {
				const authContext = await requireAuthSession();
				const { accountId } = authContext.session;

				const revokeResult = await revokeAllTokensForAccount(accountId);
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
