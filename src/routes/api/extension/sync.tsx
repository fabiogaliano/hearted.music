/**
 * Extension Sync API Route
 *
 * POST /api/extension/sync
 *
 * Thin ingress for the asynchronous sync pipeline. Accepts pre-fetched Spotify
 * data from the Chrome extension (fetched via Spotify's internal Pathfinder API
 * using intercepted session tokens) and hands it off for background processing.
 *
 * The endpoint does NOT parse or validate the body, write library data, or run
 * sync phases inline — doing so blew the Cloudflare Free-plan 50-subrequest and
 * 10 ms-CPU limits on any non-trivial library. Instead it:
 *   1. authenticates (session cookie or extension bearer token),
 *   2. streams the raw body into a private Storage object (no JSON.parse/Zod),
 *   3. calls begin_extension_sync to atomically gate + enqueue the work,
 *   4. returns 202 with the phase job ids for progress polling.
 *
 * The Bun worker (src/lib/workflows/extension-sync/runner.ts) claims the parent
 * job, downloads + validates the payload, and runs the phases with no
 * subrequest/CPU ceiling. Cost here is constant (~5 subrequests) regardless of
 * library size.
 *
 * Auth: Better Auth session cookie OR Bearer token (extension API token)
 */

import { createFileRoute } from "@tanstack/react-router";
import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { getAuthSession } from "@/lib/platform/auth/auth.server";
import { validateExtensionApiToken } from "@/lib/platform/auth/extension-api-tokens";
import { beginExtensionSync } from "@/lib/platform/jobs/extension-sync-jobs";
import {
	extensionCorsPreflightResponse,
	getExtensionCorsHeaders,
} from "@/lib/server/extension-cors";
import { readBodyWithByteCap } from "@/lib/server/request-body";
import {
	buildSyncPayloadPath,
	deleteSyncPayload,
	uploadSyncPayload,
} from "@/lib/workflows/extension-sync/payload-storage";
import { captureWithWaitUntil } from "@/utils/posthog-server";
import {
	EXTENSION_SYNC_ALREADY_RUNNING,
	EXTENSION_SYNC_COOLDOWN,
} from "../../../../shared/extension-sync-contract";

// Body size is bounded in two layers below: a required+strict Content-Length
// check rejects oversized/missing/malformed declarations up front, and
// readBodyWithByteCap streams with a hard byte cap so memory stays bounded
// during the read instead of buffering the whole 20 MB payload (which could OOM
// the 128 MB Worker isolate). The payload itself is validated later, in the
// worker, against SyncPayloadSchema — never here.
const MAX_SYNC_BODY_BYTES = 20 * 1024 * 1024;

export const Route = createFileRoute("/api/extension/sync")({
	server: {
		handlers: {
			OPTIONS: async ({ request }) => extensionCorsPreflightResponse(request),
			POST: async ({ request }) => {
				const corsHeaders = getExtensionCorsHeaders(request);
				let accountId: string | null = null;

				const authContext = await getAuthSession();
				if (authContext) {
					accountId = authContext.session.accountId;
				} else {
					const authHeader = request.headers.get("Authorization");
					if (authHeader?.startsWith("Bearer ")) {
						const token = authHeader.slice(7);
						const tokenResult = await validateExtensionApiToken(token);
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

				// Layer 1: require and strictly parse Content-Length. The protocol
				// guarantees a present header is honest (HTTP/2+ resets streams whose
				// declared length mismatches the body), so an absent or non-numeric
				// header is the only practical way to smuggle an oversized body past a
				// size check. Browsers always attach an accurate Content-Length for the
				// extension's JSON.stringify string body, so this can't reject a
				// legitimate caller. 411 for the missing/malformed declaration, 413 for
				// an honest-but-oversized one.
				const lengthHeader = request.headers.get("content-length");
				if (lengthHeader === null || !/^\d+$/.test(lengthHeader)) {
					return Response.json(
						{ error: "Content-Length required" },
						{ status: 411, headers: corsHeaders },
					);
				}
				const declaredBytes = Number(lengthHeader);
				if (declaredBytes > MAX_SYNC_BODY_BYTES) {
					return Response.json(
						{ error: "Payload too large" },
						{ status: 413, headers: corsHeaders },
					);
				}

				// Layer 2 (defense-in-depth): stream the body with a hard byte cap so
				// memory is bounded during the read even if an intermediary let a
				// mismatched length through. null means the cap was exceeded → 413.
				let rawBody: string | null;
				try {
					rawBody = await readBodyWithByteCap(request, MAX_SYNC_BODY_BYTES);
				} catch {
					return Response.json(
						{ error: "Invalid payload" },
						{ status: 400, headers: corsHeaders },
					);
				}
				if (rawBody === null) {
					return Response.json(
						{ error: "Payload too large" },
						{ status: 413, headers: corsHeaders },
					);
				}

				// Stage the raw bytes in Storage. No parse, no Zod — that work moves to
				// the worker, keeping Worker CPU inside the 10 ms Free budget.
				const supabase = createAdminSupabaseClient();
				const payloadPath = buildSyncPayloadPath(accountId);
				const uploadResult = await uploadSyncPayload(
					supabase,
					payloadPath,
					rawBody,
				);
				if (Result.isError(uploadResult)) {
					return Response.json(
						{ error: "Failed to stage sync payload" },
						{ status: 500, headers: corsHeaders },
					);
				}

				// Atomically gate (active / cooldown) and enqueue the parent + phase
				// jobs. Mirrors the old inline gate semantics, race-free.
				const beginResult = await beginExtensionSync(
					accountId,
					payloadPath,
					declaredBytes,
				);

				if (Result.isError(beginResult)) {
					// The staged object now has no job that will ever consume it; drop it
					// eagerly (the orphan sweep is the backstop) and surface the failure.
					await deleteSyncPayload(supabase, payloadPath);
					return Response.json(
						{ error: "Failed to enqueue sync" },
						{ status: 500, headers: corsHeaders },
					);
				}

				const outcome = beginResult.value;

				if (outcome.kind === "active") {
					// Gated: a sync is already in flight. The orphaned upload is harmless
					// transient Storage usage; drop it so it doesn't need the sweep.
					await deleteSyncPayload(supabase, payloadPath);
					return Response.json(
						{
							code: EXTENSION_SYNC_ALREADY_RUNNING,
							error:
								"A library sync is already running for this account. Wait for it to finish before trying again.",
						},
						{ status: 429, headers: corsHeaders },
					);
				}

				if (outcome.kind === "cooldown") {
					await deleteSyncPayload(supabase, payloadPath);
					return Response.json(
						{
							code: EXTENSION_SYNC_COOLDOWN,
							error:
								"Library sync was run too recently for this account. Wait before trying again.",
							retryAfterSeconds: outcome.retryAfterSeconds,
						},
						{
							status: 429,
							headers: {
								...corsHeaders,
								"Retry-After": String(outcome.retryAfterSeconds),
							},
						},
					);
				}

				// Counts are unknown without parsing the body; emit the byte size only.
				await captureWithWaitUntil({
					distinctId: accountId,
					event: "library_sync_queued",
					properties: {
						payload_bytes: declaredBytes,
						source: "extension",
					},
				});

				return Response.json(
					{
						ok: true,
						queued: true,
						phaseJobIds: outcome.phaseJobIds,
					},
					{ status: 202, headers: corsHeaders },
				);
			},
		},
	},
});
