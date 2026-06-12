/**
 * Extension Status API Route
 *
 * GET /api/extension/status
 *   Returns quick status for the extension to check whether the API token is
 *   valid and what data has been synced.
 *
 * POST /api/extension/status
 *   Persists a privacy-light summary of a sync attempt so operators can analyze
 *   real-world sync duration / rate limiting / failure modes remotely.
 *
 * Auth: Bearer token (extension API token)
 */

import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { Result } from "better-result";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { getCount } from "@/lib/domains/library/liked-songs/queries";
import { getPlaylistCount } from "@/lib/domains/library/playlists/queries";
import { validateExtensionApiToken } from "@/lib/platform/auth/extension-api-tokens";
import {
	extensionCorsPreflightResponse,
	getExtensionCorsHeaders,
} from "@/lib/server/extension-cors";
import {
	EXTENSION_SYNC_ALREADY_RUNNING,
	EXTENSION_SYNC_COOLDOWN,
	EXTENSION_SYNC_UNKNOWN_FAILURE,
} from "../../../../shared/extension-sync-contract";
import {
	EXTENSION_SYNC_DIAGNOSTIC_OUTCOMES,
	EXTENSION_SYNC_DIAGNOSTIC_PHASES,
} from "../../../../shared/extension-sync-diagnostics";

const DiagnosticRequestStatsSchema = z
	.object({
		started: z.number().int().nonnegative(),
		succeeded: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative(),
		rateLimitedResponses: z.number().int().nonnegative(),
		retryAttempts: z.number().int().nonnegative(),
		retryAfterSecondsTotal: z.number().int().nonnegative(),
		wallTimeMs: z.number().int().nonnegative(),
	})
	.strict();

const DiagnosticRequestPolicySchema = z
	.object({
		maxConcurrentRequests: z.number().int().positive(),
		minRequestIntervalMs: z.number().int().nonnegative(),
		maxRequestIntervalMs: z.number().int().nonnegative(),
	})
	.strict();

const DiagnosticPayloadSchema = z
	.object({
		id: z.uuid(),
		clientCreatedAt: z
			.string()
			.refine(
				(value) => Number.isFinite(Date.parse(value)),
				"clientCreatedAt must be an ISO date-time",
			),
		extensionVersion: z.string().min(1).max(40),
		outcome: z.enum(EXTENSION_SYNC_DIAGNOSTIC_OUTCOMES),
		phase: z.enum(EXTENSION_SYNC_DIAGNOSTIC_PHASES),
		backendStatus: z.number().int().min(100).max(599).nullable(),
		backendFailureCode: z
			.enum([
				EXTENSION_SYNC_ALREADY_RUNNING,
				EXTENSION_SYNC_COOLDOWN,
				EXTENSION_SYNC_UNKNOWN_FAILURE,
			])
			.nullable(),
		retryAfterSeconds: z.number().int().positive().nullable(),
		errorMessage: z.string().max(500).nullable(),
		durationMs: z.number().int().nonnegative(),
		likedSongsCount: z.number().int().nonnegative(),
		playlistCount: z.number().int().nonnegative(),
		playlistsWithTracksCount: z.number().int().nonnegative(),
		playlistTracksCount: z.number().int().nonnegative(),
		failedPlaylistTrackFetchCount: z.number().int().nonnegative(),
		skippedEmptyPlaylistsCount: z.number().int().nonnegative(),
		requestStats: DiagnosticRequestStatsSchema,
		requestPolicy: DiagnosticRequestPolicySchema,
	})
	.strict();

type ExtensionAuthResult =
	| { kind: "missing" }
	| { kind: "invalid" }
	| { kind: "ok"; accountId: string };

async function authenticateExtensionToken(
	request: Request,
): Promise<ExtensionAuthResult> {
	const authHeader = request.headers.get("Authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		return { kind: "missing" };
	}

	const token = authHeader.slice(7);
	const tokenResult = await validateExtensionApiToken(token);
	if (Result.isError(tokenResult) || !tokenResult.value) {
		return { kind: "invalid" };
	}

	return { kind: "ok", accountId: tokenResult.value };
}

export const Route = createFileRoute("/api/extension/status")({
	server: {
		handlers: {
			OPTIONS: async ({ request }) => extensionCorsPreflightResponse(request),
			GET: async () => {
				const request = getRequest();
				const corsHeaders = getExtensionCorsHeaders(request);
				const auth = await authenticateExtensionToken(request);

				if (auth.kind === "missing") {
					return Response.json(
						{ authenticated: false, likedSongCount: 0, playlistCount: 0 },
						{ headers: corsHeaders },
					);
				}
				if (auth.kind === "invalid") {
					return Response.json(
						{ error: "Invalid or revoked API token" },
						{ status: 401, headers: corsHeaders },
					);
				}

				const accountId = auth.accountId;
				const supabase = createAdminSupabaseClient();
				const { data: account } = await supabase
					.from("account")
					.select("display_name, email")
					.eq("id", accountId)
					.single();

				const [likedCountResult, playlistCountResult] = await Promise.all([
					getCount(accountId),
					getPlaylistCount(accountId),
				]);

				return Response.json(
					{
						authenticated: true,
						accountId,
						displayName: account?.display_name ?? null,
						email: account?.email ?? null,
						likedSongCount: Result.isOk(likedCountResult)
							? likedCountResult.value
							: 0,
						playlistCount: Result.isOk(playlistCountResult)
							? playlistCountResult.value
							: 0,
					},
					{ headers: corsHeaders },
				);
			},
			POST: async ({ request }) => {
				const corsHeaders = getExtensionCorsHeaders(request);
				const auth = await authenticateExtensionToken(request);
				if (auth.kind !== "ok") {
					return Response.json(
						{ error: "Invalid or revoked API token" },
						{ status: 401, headers: corsHeaders },
					);
				}
				const accountId = auth.accountId;

				let payload: z.infer<typeof DiagnosticPayloadSchema>;
				try {
					payload = DiagnosticPayloadSchema.parse(await request.json());
				} catch {
					return Response.json(
						{ error: "Invalid payload" },
						{ status: 400, headers: corsHeaders },
					);
				}

				const supabase = createAdminSupabaseClient();
				const { error } = await supabase
					.from("extension_sync_diagnostic")
					.upsert(
						{
							id: payload.id,
							account_id: accountId,
							client_created_at: payload.clientCreatedAt,
							extension_version: payload.extensionVersion,
							outcome: payload.outcome,
							phase: payload.phase,
							backend_status: payload.backendStatus,
							backend_failure_code: payload.backendFailureCode,
							retry_after_seconds: payload.retryAfterSeconds,
							error_message: payload.errorMessage,
							duration_ms: payload.durationMs,
							liked_songs_count: payload.likedSongsCount,
							playlist_count: payload.playlistCount,
							playlists_with_tracks_count: payload.playlistsWithTracksCount,
							playlist_tracks_count: payload.playlistTracksCount,
							failed_playlist_track_fetch_count:
								payload.failedPlaylistTrackFetchCount,
							skipped_empty_playlists_count: payload.skippedEmptyPlaylistsCount,
							request_stats: payload.requestStats,
							request_policy: payload.requestPolicy,
						},
						{ onConflict: "id" },
					);

				if (error) {
					return Response.json(
						{ error: "Failed to store sync diagnostic" },
						{ status: 500, headers: corsHeaders },
					);
				}

				return Response.json({ ok: true }, { headers: corsHeaders });
			},
		},
	},
});
