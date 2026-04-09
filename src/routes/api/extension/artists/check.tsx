import { createFileRoute } from "@tanstack/react-router";
import { Result } from "better-result";
import { z } from "zod";
import { validateApiToken } from "@/lib/data/api-tokens";
import * as artistData from "@/lib/domains/library/artists/queries";
import { getAuthSession } from "@/lib/platform/auth/auth.server";
import {
	extensionCorsPreflightResponse,
	getExtensionCorsHeaders,
} from "@/lib/server/extension-cors";

const ArtistCheckPayloadSchema = z.object({
	artistIds: z.array(z.string()).max(5000),
});

async function getAuthenticatedAccountId(
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

	const token = authHeader.slice(7);
	const tokenResult = await validateApiToken(token);
	if (Result.isOk(tokenResult) && tokenResult.value) {
		return tokenResult.value;
	}

	return null;
}

export const Route = createFileRoute("/api/extension/artists/check")({
	server: {
		handlers: {
			OPTIONS: async ({ request }) => extensionCorsPreflightResponse(request),
			POST: async ({ request }) => {
				const corsHeaders = getExtensionCorsHeaders(request);
				const accountId = await getAuthenticatedAccountId(request);

				if (!accountId) {
					return Response.json(
						{ error: "Not authenticated" },
						{ status: 401, headers: corsHeaders },
					);
				}

				let payload: z.infer<typeof ArtistCheckPayloadSchema>;
				try {
					const body = await request.json();
					payload = ArtistCheckPayloadSchema.parse(body);
				} catch {
					return Response.json(
						{ error: "Invalid payload" },
						{ status: 400, headers: corsHeaders },
					);
				}

				const artistsResult = await artistData.getWithImagesBySpotifyIds(
					payload.artistIds,
				);
				if (Result.isError(artistsResult)) {
					return Response.json(
						{ error: "Failed to check artists" },
						{ status: 500, headers: corsHeaders },
					);
				}

				return Response.json(
					{ artists: artistsResult.value },
					{ headers: corsHeaders },
				);
			},
		},
	},
});
