/**
 * Release-Year Pending-Lookup API Route
 *
 * POST /api/extension/release-year/pending
 *
 * DB-authoritative selection for the extension's liked-song release-year
 * hydration. The extension sends the Spotify ids of liked songs still missing a
 * year locally; this returns the subset that still needs a getTrack lookup —
 * i.e. ids that are neither already resolved nor already checked in the catalog
 * (`release_year IS NULL AND release_year_checked_at IS NULL`). Ids not yet in
 * the catalog (a brand-new like) are returned as needing lookup.
 *
 * This replaces the extension's old browser-local "attempted" set, so coverage
 * converges across devices and survives a storage reset / reinstall.
 *
 * Auth: Better Auth session cookie OR Bearer token (extension API token)
 */

import { createFileRoute } from "@tanstack/react-router";
import { Result } from "better-result";
import { z } from "zod";
import { getResolvedOrCheckedReleaseYearIds } from "@/lib/domains/library/songs/queries";
import { resolveExtensionAccountId } from "@/lib/server/extension-auth";
import {
	extensionCorsPreflightResponse,
	getExtensionCorsHeaders,
} from "@/lib/server/extension-cors";
import { MAX_LIKED_SONGS } from "../../../../../shared/spotify-sync-payload-schema";

const PendingPayloadSchema = z.object({
	spotifyIds: z.array(z.string()).max(MAX_LIKED_SONGS),
});

export const Route = createFileRoute("/api/extension/release-year/pending")({
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

				let payload: z.infer<typeof PendingPayloadSchema>;
				try {
					payload = PendingPayloadSchema.parse(await request.json());
				} catch {
					return Response.json(
						{ error: "Invalid payload" },
						{ status: 400, headers: corsHeaders },
					);
				}

				const doneResult = await getResolvedOrCheckedReleaseYearIds(
					payload.spotifyIds,
				);
				if (Result.isError(doneResult)) {
					return Response.json(
						{ error: "Failed to check release-year state" },
						{ status: 500, headers: corsHeaders },
					);
				}

				const done = doneResult.value;
				const needsLookup = payload.spotifyIds.filter((id) => !done.has(id));

				return Response.json({ needsLookup }, { headers: corsHeaders });
			},
		},
	},
});
