import { createFileRoute } from "@tanstack/react-router";
import { Result } from "better-result";
import { z } from "zod";
import { getWithImagesBySpotifyIds } from "@/lib/domains/library/artists/queries";
import { resolveExtensionAccountId } from "@/lib/server/extension-auth";
import {
	extensionCorsPreflightResponse,
	getExtensionCorsHeaders,
} from "@/lib/server/extension-cors";

const ArtistCheckPayloadSchema = z.object({
	artistIds: z.array(z.string()).max(5000),
});

export const Route = createFileRoute("/api/extension/artists/check")({
	server: {
		handlers: {
			OPTIONS: async ({ request }) => extensionCorsPreflightResponse(request),
			POST: async ({ request }) => {
				const corsHeaders = getExtensionCorsHeaders(request);
				const accountId = await resolveExtensionAccountId(request);

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

				const artistsResult = await getWithImagesBySpotifyIds(
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
