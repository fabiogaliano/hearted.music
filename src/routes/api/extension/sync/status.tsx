/**
 * Extension Sync Status API Route
 *
 * GET /api/extension/sync/status
 *
 * Cheap progress pull for the asynchronous sync pipeline. Reads the three phase
 * job ids the worker is driving (persisted in user_preferences.phase_job_ids by
 * begin_extension_sync) and returns their rows in a single PostgREST `.in()`
 * call. Each poll is its own Worker invocation against a fresh 50-subrequest
 * budget, so client polling here is harmless to the cap.
 *
 * This is the extension's fallback path; a browser would ideally use Supabase
 * Realtime, but that needs a Supabase JWT the Better-Auth app doesn't mint yet
 * (see the plan's Phase 5.3 — out of scope).
 *
 * Auth: Better Auth session cookie OR Bearer token (extension API token)
 */

import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { getAuthSession } from "@/lib/platform/auth/auth.server";
import { validateExtensionApiToken } from "@/lib/platform/auth/extension-api-tokens";
import {
	type PhaseJobIds,
	PhaseJobIdsSchema,
} from "@/lib/platform/jobs/progress/types";
import {
	extensionCorsPreflightResponse,
	getExtensionCorsHeaders,
} from "@/lib/server/extension-cors";

type PhaseName = keyof PhaseJobIds;

const PHASE_BY_ID = (phaseJobIds: PhaseJobIds): Map<string, PhaseName> =>
	new Map<string, PhaseName>([
		[phaseJobIds.liked_songs, "liked_songs"],
		[phaseJobIds.playlists, "playlists"],
		[phaseJobIds.playlist_tracks, "playlist_tracks"],
	]);

export const Route = createFileRoute("/api/extension/sync/status")({
	server: {
		handlers: {
			OPTIONS: async ({ request }) => extensionCorsPreflightResponse(request),
			GET: async () => {
				const request = getRequest();
				const corsHeaders = getExtensionCorsHeaders(request);

				let accountId: string | null = null;
				const authContext = await getAuthSession();
				if (authContext) {
					accountId = authContext.session.accountId;
				} else {
					const authHeader = request.headers.get("Authorization");
					if (authHeader?.startsWith("Bearer ")) {
						const tokenResult = await validateExtensionApiToken(
							authHeader.slice(7),
						);
						if (Result.isOk(tokenResult) && tokenResult.value) {
							accountId = tokenResult.value;
						}
					}
				}

				if (!accountId) {
					return Response.json(
						{ error: "Not authenticated" },
						{ status: 401, headers: corsHeaders },
					);
				}

				const supabase = createAdminSupabaseClient();

				const { data: prefs } = await supabase
					.from("user_preferences")
					.select("phase_job_ids")
					.eq("account_id", accountId)
					.maybeSingle();

				const parsedIds = PhaseJobIdsSchema.safeParse(prefs?.phase_job_ids);
				if (!parsedIds.success) {
					// No tracked sync (never synced, or pointer cleared).
					return Response.json(
						{ phaseJobIds: null, phases: null },
						{ headers: corsHeaders },
					);
				}

				const phaseJobIds = parsedIds.data;
				const ids = [
					phaseJobIds.liked_songs,
					phaseJobIds.playlists,
					phaseJobIds.playlist_tracks,
				];

				const { data: rows, error } = await supabase
					.from("job")
					.select("id, status, progress, error")
					.in("id", ids);

				if (error) {
					return Response.json(
						{ error: "Failed to read sync status" },
						{ status: 500, headers: corsHeaders },
					);
				}

				const phaseById = PHASE_BY_ID(phaseJobIds);
				const phases: Record<
					PhaseName,
					{ status: string; progress: unknown; error: string | null } | null
				> = {
					liked_songs: null,
					playlists: null,
					playlist_tracks: null,
				};

				for (const row of rows ?? []) {
					const phase = phaseById.get(row.id);
					if (!phase) continue;
					phases[phase] = {
						status: row.status,
						progress: row.progress,
						error: row.error,
					};
				}

				return Response.json({ phaseJobIds, phases }, { headers: corsHeaders });
			},
		},
	},
});
