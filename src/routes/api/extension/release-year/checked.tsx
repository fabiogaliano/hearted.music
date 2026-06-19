/**
 * Release-Year Lookup-Completion API Route
 *
 * POST /api/extension/release-year/checked
 *
 * Durable write side of the extension's liked-song release-year hydration. After
 * the extension runs getTrack for the selected songs, it posts the results here
 * (resolved year, or null when Spotify had no usable year). Only songs the
 * authenticated account currently likes are eligible to update global lookup
 * state; each matched catalog row then gets release_year filled where still
 * missing and release_year_checked_at stamped regardless of outcome, so a
 * checked-but-year-less song is never re-queried by any device.
 *
 * Separate from the (asynchronous, Storage-staged) sync POST on purpose: this
 * updates existing catalog rows synchronously, which the sync payload can't do
 * for already-liked songs — incremental sync only upserts newly-added likes.
 *
 * Auth: Better Auth session cookie OR Bearer token (extension API token)
 */

import { createFileRoute } from "@tanstack/react-router";
import { Result } from "better-result";
import { z } from "zod";
import {
	applyReleaseYearLookups,
	getActivelyLikedSpotifyIdsForAccount,
} from "@/lib/domains/library/songs/queries";
import { resolveExtensionAccountId } from "@/lib/server/extension-auth";
import {
	extensionCorsPreflightResponse,
	getExtensionCorsHeaders,
} from "@/lib/server/extension-cors";
import { MAX_LIKED_SONGS } from "@/lib/workflows/spotify-sync/payload-schema";

const CheckedPayloadSchema = z.object({
	lookups: z
		.array(
			z.object({
				spotifyId: z.string(),
				releaseYear: z.number().int().nullable(),
			}),
		)
		.max(MAX_LIKED_SONGS),
});

export const Route = createFileRoute("/api/extension/release-year/checked")({
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

				let payload: z.infer<typeof CheckedPayloadSchema>;
				try {
					payload = CheckedPayloadSchema.parse(await request.json());
				} catch {
					return Response.json(
						{ error: "Invalid payload" },
						{ status: 400, headers: corsHeaders },
					);
				}

				const activeIdsResult = await getActivelyLikedSpotifyIdsForAccount(
					accountId,
					payload.lookups.map((lookup) => lookup.spotifyId),
				);
				if (Result.isError(activeIdsResult)) {
					return Response.json(
						{ error: "Failed to authorize release-year lookups" },
						{ status: 500, headers: corsHeaders },
					);
				}

				const authorizedLookups = payload.lookups.filter((lookup) =>
					activeIdsResult.value.has(lookup.spotifyId),
				);
				const applyResult = await applyReleaseYearLookups(authorizedLookups);
				if (Result.isError(applyResult)) {
					return Response.json(
						{ error: "Failed to record release-year lookups" },
						{ status: 500, headers: corsHeaders },
					);
				}

				return Response.json(
					{ ok: true, updated: applyResult.value },
					{ headers: corsHeaders },
				);
			},
		},
	},
});
