/**
 * Control-panel API server (Bun).
 *
 * Local-only: serves prod metrics + operations to the Vite UI, which proxies
 * /api here. Never deployed. Reads prod creds from .env.cloud / .env, the same
 * files the supabase-prod skill uses.
 */

import {
	approveAudioReview,
	audioReviewsPage,
	rejectAudioReview,
	replaceAudioReviewWithYoutube,
} from "./audio-feature-reviews";
import {
	countAudioQueueBuckets,
	type JobFilter,
	listAudioFeatureJobs,
	submitManualUrl,
} from "./audio-feature-jobs";
import { cached } from "./cache";
import { prodRef, warm } from "./db";
import { HttpError } from "./http-error";
import {
	previewStyledEmail,
	renderStyledEmail,
	sendStyledEmail,
} from "./email";
import { audioSourcesForInstrumentalReview } from "./instrumental-audio";
import {
	approveInstrumentalReview,
	countPendingInstrumentalReviews,
	instrumentalReviewsPage,
	rejectInstrumentalReview,
} from "./instrumental-reviews";
import { accountsByLikedExport, accountsByLikedPage } from "./library-list";
import { lyricsCandidatesForSong } from "./lyrics-fetch";
import {
	countLyricsBuckets,
	lyricsReviewsPage,
	markInstrumental,
	saveManualLyrics,
} from "./lyrics-reviews";
import {
	accountsWithoutLibraryOlderThan,
	billingMetrics,
	enrichmentMetrics,
	jobMetrics,
	libraryMetrics,
	overviewComparisons,
	parseOverviewRange,
	searchVerifiedAccounts,
	userDetail,
	usersMetrics,
} from "./metrics";
import {
	commitOperationFromFacts,
	OPERATIONS,
	previewOperation,
} from "./operations";
import { usersListExport, usersListPage } from "./users-list";
import { enrichmentAccountsPage } from "./enrichment-accounts";
import { grantsExport, grantsPage, subscriptionsExport, subscriptionsPage } from "./billing-lists";
import { jobFailuresExport, jobFailuresPage, jobRunFailures, jobRunsExport, jobRunsPage } from "./job-lists";
import { exportFilename, exportResponse, toCsv } from "./export";
import { userSongsPage } from "./user-songs";
import {
	historyExport,
	historyPage,
	historyRun,
	historySummary,
} from "./history-api";
import { recordAction, redactText } from "./local-store/record";
import {
	cancelBatch,
	commitBatch,
	getBatchView,
	previewBatch,
	resumeBatch,
	retryFailedBatch,
} from "./batches";
import { listActiveBatches } from "./local-store/batches";
import {
	deletePreview,
	getValidPreview,
	insertPreview,
	PREVIEW_TTL_MS,
	prunePreviews,
} from "./local-store/operation-previews";
import {
	getLocalStore,
	initLocalStore,
	isLocalStoreReady,
} from "./local-store/store";
import {
	releaseYearGroupsPage,
	setReleaseYearForAlbum,
	yearCandidatesForAlbums,
} from "./release-year-groups";
import {
	countReleaseYearBuckets,
	releaseYearReviewsPage,
	revertReleaseYear,
	setReleaseYear,
} from "./release-year-reviews";
import { getActionRun } from "./local-store/action-runs";

const PORT = Number(process.env.CP_API_PORT ?? 4319);

const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...CORS },
	});
}

// The non-sensitive slice of an operation's input recorded in action history.
function operationInputSummary(
	input: Record<string, unknown>,
): Record<string, unknown> {
	return {
		grantType: typeof input.grantType === "string" ? input.grantType : "songs",
		...(input.limit !== undefined ? { limit: input.limit } : {}),
		...(typeof input.requestedBy === "string" && input.requestedBy
			? { requestedBy: input.requestedBy }
			: {}),
		...(typeof input.reason === "string" && input.reason
			? { reason: input.reason }
			: {}),
	};
}

const METRIC_HANDLERS: Record<string, () => Promise<unknown>> = {
	users: usersMetrics,
	library: libraryMetrics,
	enrichment: enrichmentMetrics,
	jobs: jobMetrics,
	billing: billingMetrics,
};

// Initialize the local action-history store before serving. If this fails, reads
// still work but every mutating route returns 503 (recordAction enforces it).
await initLocalStore();

const server = Bun.serve({
	port: PORT,
	idleTimeout: 60,
	async fetch(req) {
		const url = new URL(req.url);
		const path = url.pathname;
		// The UI's "Refresh" button appends ?fresh=1 to bypass the read cache.
		const fresh = url.searchParams.get("fresh") === "1";

		if (req.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS });
		}

		try {
			if (path === "/api/health") {
				return json({
					ok: true,
					ref: prodRef(),
					historyReady: isLocalStoreReady(),
				});
			}

			if (path === "/api/history" && req.method === "GET") {
				return json(historyPage(url));
			}
			if (path === "/api/history/summary" && req.method === "GET") {
				return json(historySummary());
			}
			if (path === "/api/history/export.json" && req.method === "GET") {
				return exportResponse(
					exportFilename("action-history", prodRef(), "json"),
					JSON.stringify(historyExport(url)),
					"json",
				);
			}
			const historyRunMatch = path.match(/^\/api\/history\/([0-9a-fA-F-]+)$/);
			if (historyRunMatch && req.method === "GET") {
				const run = historyRun(historyRunMatch[1]!);
				if (!run) return json({ error: "Run not found" }, 404);
				return json(run);
			}

			const metricMatch = path.match(/^\/api\/metrics\/([a-z]+)$/);
			if (metricMatch && req.method === "GET") {
				const name = metricMatch[1]!;
				const handler = METRIC_HANDLERS[name];
				if (!handler) return json({ error: "Unknown metric" }, 404);
				return json(await cached(`metric:${name}`, handler, fresh));
			}

			if (path === "/api/metrics/overview-comparison" && req.method === "GET") {
				const range = parseOverviewRange(url.searchParams.get("range"));
				return json(await cached(`metric:overview-comparison:${range}`, () => overviewComparisons(range), fresh));
			}

			if (path === "/api/metrics/no-library-accounts" && req.method === "GET") {
				const hours = Number(url.searchParams.get("olderThanHours") ?? "24");
				return json(await cached(`metric:no-library-accounts:${hours}`, () => accountsWithoutLibraryOlderThan(hours).then((count) => ({ count })), fresh));
			}

			if (path === "/api/billing/grants" && req.method === "GET") {
				return json(await grantsPage(url));
			}
			if (path === "/api/billing/subscriptions" && req.method === "GET") {
				return json(await subscriptionsPage(url));
			}

			if (path === "/api/enrichment/accounts" && req.method === "GET") {
				const cacheParams = new URLSearchParams(url.searchParams);
				cacheParams.delete("fresh");
				return json(await cached(`enrichment:accounts:${cacheParams.toString()}`, () => enrichmentAccountsPage(url), fresh));
			}

			if (path === "/api/jobs/failures" && req.method === "GET") {
				const cacheParams = new URLSearchParams(url.searchParams);
				cacheParams.delete("fresh");
				return json(await cached(`jobs:failures:${cacheParams.toString()}`, () => jobFailuresPage(url), fresh));
			}

			if (path === "/api/jobs/runs" && req.method === "GET") {
				const cacheParams = new URLSearchParams(url.searchParams);
				cacheParams.delete("fresh");
				return json(await cached(`jobs:runs:${cacheParams.toString()}`, () => jobRunsPage(url), fresh));
			}

			const jobRunFailuresMatch = path.match(/^\/api\/jobs\/([0-9a-fA-F-]+)\/failures$/);
			if (jobRunFailuresMatch && req.method === "GET") {
				const id = jobRunFailuresMatch[1]!;
				try {
					return json({ failures: await jobRunFailures(id) });
				} catch (error) {
					if (error instanceof Error) return json({ error: error.message }, 400);
					throw error;
				}
			}

			const userExport = path.match(/^\/api\/exports\/users\.(csv|json)$/);
			if (userExport && req.method === "GET") {
				try {
					const rows = await usersListExport(url);
					const extension = userExport[1];
					if (extension === "json") return exportResponse(exportFilename("users", prodRef(), "json"), JSON.stringify(rows), "json");
					return exportResponse(
						exportFilename("users", prodRef(), "csv"),
						toCsv(["id", "label", "handle", "email", "emailVerified", "createdAt", "lastSeenAt", "liked", "playlists", "unlocks", "plan", "unlimited"], rows.map((row) => [row.id, row.label, row.handle, row.email, row.emailVerified, row.createdAt, row.lastSeenAt, row.liked, row.playlists, row.unlocks, row.plan, row.unlimited])),
						"csv",
					);
				} catch (error) {
					if (error instanceof RangeError) return json({ error: error.message }, 422);
					throw error;
				}
			}

			const accountExport = path.match(/^\/api\/exports\/accounts-by-liked\.(csv|json)$/);
			if (accountExport && req.method === "GET") {
				try {
					const rows = await accountsByLikedExport(url);
					const extension = accountExport[1];
					if (extension === "json") return exportResponse(exportFilename("accounts-by-liked", prodRef(), "json"), JSON.stringify(rows), "json");
					return exportResponse(exportFilename("accounts-by-liked", prodRef(), "csv"), toCsv(["id", "label", "handle", "email", "liked", "playlists", "createdAt"], rows.map((row) => [row.id, row.label, row.handle, row.email, row.liked, row.playlists, row.createdAt])), "csv");
				} catch (error) {
					if (error instanceof RangeError) return json({ error: error.message }, 422);
					throw error;
				}
			}

			const grantsExportMatch = path.match(/^\/api\/exports\/billing-grants\.(csv|json)$/);
			if (grantsExportMatch && req.method === "GET") {
				try {
					const rows = await grantsExport(url);
					const extension = grantsExportMatch[1];
					if (extension === "json") return exportResponse(exportFilename("billing-grants", prodRef(), "json"), JSON.stringify(rows), "json");
					return exportResponse(
						exportFilename("billing-grants", prodRef(), "csv"),
						toCsv(["id", "accountId", "accountLabel", "origin", "status", "createdAt", "appliedAt", "requestedBy", "note"], rows.map((row) => [row.id, row.accountId, row.accountLabel, row.origin, row.status, row.createdAt, row.appliedAt, row.requestedBy, row.note])),
						"csv",
					);
				} catch (error) {
					if (error instanceof RangeError) return json({ error: error.message }, 422);
					throw error;
				}
			}

			const subscriptionsExportMatch = path.match(/^\/api\/exports\/billing-subscriptions\.(csv|json)$/);
			if (subscriptionsExportMatch && req.method === "GET") {
				try {
					const rows = await subscriptionsExport(url);
					const extension = subscriptionsExportMatch[1];
					if (extension === "json") return exportResponse(exportFilename("billing-subscriptions", prodRef(), "json"), JSON.stringify(rows), "json");
					return exportResponse(
						exportFilename("billing-subscriptions", prodRef(), "csv"),
						toCsv(["accountId", "accountLabel", "plan", "status", "unlimitedSource", "periodEnd", "cancelAtPeriodEnd", "creditBalance", "syntheticGift"], rows.map((row) => [row.accountId, row.accountLabel, row.plan, row.status, row.unlimitedSource, row.periodEnd, row.cancelAtPeriodEnd, row.creditBalance, row.syntheticGift])),
						"csv",
					);
				} catch (error) {
					if (error instanceof RangeError) return json({ error: error.message }, 422);
					throw error;
				}
			}

			const jobFailuresExportMatch = path.match(/^\/api\/exports\/job-failures\.(csv|json)$/);
			if (jobFailuresExportMatch && req.method === "GET") {
				try {
					const rows = await jobFailuresExport(url);
					const extension = jobFailuresExportMatch[1];
					if (extension === "json") return exportResponse(exportFilename("job-failures", prodRef(), "json"), JSON.stringify(rows), "json");
					return exportResponse(
						exportFilename("job-failures", prodRef(), "csv"),
						toCsv(["id", "itemType", "itemId", "itemLabel", "failureCode", "stage", "errorMessage", "isTerminal", "createdAt", "accountId", "accountLabel"], rows.map((row) => [row.id, row.itemType, row.itemId, row.itemLabel, row.failureCode, row.stage, row.errorMessage, row.isTerminal, row.createdAt, row.accountId, row.accountLabel])),
						"csv",
					);
				} catch (error) {
					if (error instanceof RangeError) return json({ error: error.message }, 422);
					throw error;
				}
			}

			const jobRunsExportMatch = path.match(/^\/api\/exports\/job-runs\.(csv|json)$/);
			if (jobRunsExportMatch && req.method === "GET") {
				try {
					const rows = await jobRunsExport(url);
					const extension = jobRunsExportMatch[1];
					if (extension === "json") return exportResponse(exportFilename("job-runs", prodRef(), "json"), JSON.stringify(rows), "json");
					return exportResponse(
						exportFilename("job-runs", prodRef(), "csv"),
						toCsv(["id", "accountId", "accountLabel", "type", "status", "stale", "createdAt", "startedAt", "completedAt", "updatedAt", "heartbeatAt", "error"], rows.map((row) => [row.id, row.accountId, row.accountLabel, row.type, row.status, row.stale, row.createdAt, row.startedAt, row.completedAt, row.updatedAt, row.heartbeatAt, row.error])),
						"csv",
					);
				} catch (error) {
					if (error instanceof RangeError) return json({ error: error.message }, 422);
					throw error;
				}
			}

			if (path === "/api/users/list" && req.method === "GET") {
				const cacheParams = new URLSearchParams(url.searchParams);
				cacheParams.delete("fresh");
				return json(
					await cached(
						`users:list:${cacheParams.toString()}`,
						() => usersListPage(url),
						fresh,
					),
				);
			}

			if (path === "/api/accounts/search" && req.method === "GET") {
				const q = url.searchParams.get("q") ?? "";
				return json({ accounts: await searchVerifiedAccounts(q) });
			}

			if (path === "/api/accounts/by-liked" && req.method === "GET") {
				const cacheParams = new URLSearchParams(url.searchParams);
				cacheParams.delete("fresh");
				return json(
					await cached(
						`accounts:by-liked:${cacheParams.toString()}`,
						() => accountsByLikedPage(url),
						fresh,
					),
				);
			}

			const userSongsMatch = path.match(/^\/api\/users\/([0-9a-fA-F-]+)\/songs$/);
			if (userSongsMatch && req.method === "GET") {
				const id = userSongsMatch[1];
				if (!id) return json({ error: "Invalid account id" }, 400);
				return json(await userSongsPage(id, url));
			}

			const userMatch = path.match(/^\/api\/users\/([0-9a-fA-F-]+)$/);
			if (userMatch && req.method === "GET") {
				const id = userMatch[1]!;
				const detail = await cached(`user:${id}`, () => userDetail(id), fresh);
				if (!detail) return json({ error: "Account not found" }, 404);
				return json(detail);
			}

			if (path === "/api/operations" && req.method === "GET") {
				return json({ operations: OPERATIONS });
			}

			// A successful dry run persists a preview (input hash + state fingerprint)
			// and is required before Commit. Recorded as a dry_run action.
			const previewMatch = path.match(
				/^\/api\/operations\/([a-z-]+)\/preview$/,
			);
			if (previewMatch && req.method === "POST") {
				const operationId = previewMatch[1]!;
				const input = (await req.json().catch(() => ({}))) as Record<
					string,
					unknown
				>;
				const accountId =
					typeof input.accountId === "string" ? input.accountId : null;
				const outcome = await recordAction({
					actionType: operationId,
					mode: "dry_run",
					targetType: "account",
					targetId: accountId,
					inputSummary: operationInputSummary(input),
					run: () => previewOperation(operationId, input),
					summarize: (o) => ({
						status: o.ok ? "succeeded" : "failed",
						result: {
							willChange: o.preview.willChange,
							title: o.preview.title,
						},
						targetLabel:
							o.preview.targetLabel === "—" ? null : o.preview.targetLabel,
					}),
				});
				if (!outcome.ok || !outcome.fingerprints) {
					return json({ previewId: null, expiresAt: null, preview: outcome.preview });
				}
				const now = Date.now();
				const createdAt = new Date(now).toISOString();
				const expiresAt = new Date(now + PREVIEW_TTL_MS).toISOString();
				const previewId = crypto.randomUUID();
				const db = getLocalStore();
				prunePreviews(db, createdAt);
				insertPreview(db, {
					id: previewId,
					prodRef: prodRef(),
					actionType: operationId,
					targetId: outcome.preview.targetId,
					inputHash: outcome.fingerprints.inputHash,
					stateFingerprint: outcome.fingerprints.stateFingerprint,
					previewJson: JSON.stringify(outcome.preview),
					createdAt,
					expiresAt,
				});
				return json({ previewId, expiresAt, preview: outcome.preview });
			}

			// Commit re-gathers facts and refuses (409) unless the stored preview is
			// current and both its input hash and state fingerprint still match — no
			// prod write happens on a conflict.
			const commitMatch = path.match(/^\/api\/operations\/([a-z-]+)\/commit$/);
			if (commitMatch && req.method === "POST") {
				const operationId = commitMatch[1]!;
				const input = (await req.json().catch(() => ({}))) as Record<
					string,
					unknown
				>;
				const previewId =
					typeof input.previewId === "string" ? input.previewId : null;
				if (!previewId) {
					return json(
						{ error: "A current preview is required before commit." },
						409,
					);
				}
				if (!isLocalStoreReady()) {
					return json(
						{
							error:
								"Local action history is unavailable; refusing to mutate production.",
						},
						503,
					);
				}
				const db = getLocalStore();
				const stored = getValidPreview(db, previewId, new Date().toISOString());
				if (!stored || stored.actionType !== operationId) {
					return json(
						{
							error:
								"Preview expired or not found — run a new dry run before committing.",
						},
						409,
					);
				}
				if (stored.prodRef !== prodRef()) {
					return json(
						{
							error:
								"Preview was taken against a different production project — run a new dry run.",
						},
						409,
					);
				}
				const fresh = await previewOperation(operationId, input);
				if (!fresh.ok || !fresh.fingerprints || !fresh.facts) {
					return json(
						{ error: fresh.preview.rows[0]?.value ?? "Cannot resolve target." },
						409,
					);
				}
				if (fresh.fingerprints.inputHash !== stored.inputHash) {
					return json(
						{ error: "Inputs changed since the preview — run a new dry run." },
						409,
					);
				}
				if (fresh.fingerprints.stateFingerprint !== stored.stateFingerprint) {
					return json(
						{
							error:
								"Production state changed since the preview — run a new dry run.",
						},
						409,
					);
				}
				const facts = fresh.facts;
				let runId: string | null = null;
				const result = await recordAction({
					actionType: operationId,
					mode: "commit",
					targetType: "account",
					targetId: facts.accountId,
					inputSummary: operationInputSummary(input),
					onRecorded: (id) => {
						runId = id;
					},
					run: () => commitOperationFromFacts(facts, input),
					summarize: (r) => {
						const details = r.details ?? {};
						const label =
							typeof details.displayName === "string"
								? details.displayName
								: typeof details.email === "string"
									? details.email
									: null;
						return {
							// A committed op that reports ok:false is a failure.
							status: r.ok ? "succeeded" : "failed",
							result: { status: r.status, message: r.message, ...details },
							targetLabel: label,
						};
					},
				});
				deletePreview(db, previewId);
				return json({ ...result, runId });
			}

			// Live composer preview — lenient render, never sends, never throws on
			// half-typed input (so the iframe updates on every keystroke).
			// Durable batches: preview snapshots the exact cohort into local SQLite;
			// commit gates on that snapshot and runs asynchronously (see ./batches.ts).
			if (path === "/api/batches" && req.method === "GET") {
				if (!isLocalStoreReady()) return json({ batches: [] });
				return json({ batches: listActiveBatches(getLocalStore()) });
			}

			if (path === "/api/batches/preview" && req.method === "POST") {
				const input = (await req.json().catch(() => ({}))) as Record<
					string,
					unknown
				>;
				const actionType =
					typeof input.actionType === "string" ? input.actionType : "";
				return json(await previewBatch(actionType, input));
			}

			const batchCommitMatch = path.match(
				/^\/api\/batches\/([0-9a-fA-F-]+)\/commit$/,
			);
			if (batchCommitMatch && req.method === "POST") {
				const body = (await req.json().catch(() => ({}))) as {
					testedBodyHash?: unknown;
				};
				const testedBodyHash =
					typeof body.testedBodyHash === "string" ? body.testedBodyHash : null;
				return json(commitBatch(batchCommitMatch[1]!, { testedBodyHash }));
			}

			const batchCancelMatch = path.match(
				/^\/api\/batches\/([0-9a-fA-F-]+)\/cancel$/,
			);
			if (batchCancelMatch && req.method === "POST") {
				return json(cancelBatch(batchCancelMatch[1]!));
			}

			const batchRetryMatch = path.match(
				/^\/api\/batches\/([0-9a-fA-F-]+)\/retry-failed$/,
			);
			if (batchRetryMatch && req.method === "POST") {
				return json(retryFailedBatch(batchRetryMatch[1]!));
			}

			const batchResumeMatch = path.match(
				/^\/api\/batches\/([0-9a-fA-F-]+)\/resume$/,
			);
			if (batchResumeMatch && req.method === "POST") {
				return json(resumeBatch(batchResumeMatch[1]!));
			}

			const batchGetMatch = path.match(/^\/api\/batches\/([0-9a-fA-F-]+)$/);
			if (batchGetMatch && req.method === "GET") {
				return json(getBatchView(batchGetMatch[1]!));
			}

			// Email's batch test-send gate: one real send to the operator's own
			// address, returning the body hash the batch commit must echo back.
			if (path === "/api/email/test" && req.method === "POST") {
				const input = (await req.json().catch(() => ({}))) as Record<
					string,
					unknown
				>;
				const to = typeof input.to === "string" ? input.to : null;
				const subject =
					typeof input.subject === "string" ? input.subject : null;
				const bodyText = typeof input.body === "string" ? input.body : "";
				const result = await recordAction({
					actionType: "email-test",
					mode: "commit",
					targetType: "email",
					targetId: to,
					targetLabel: subject,
					inputSummary: { subject, body: redactText(bodyText) },
					run: async () => {
						const email = renderStyledEmail(input);
						const sent = await sendStyledEmail(email);
						return { ok: true, to: email.to, id: sent.id };
					},
					summarize: (r) => ({ result: { to: r.to }, externalId: r.id }),
				});
				return json({ ...result, bodyHash: redactText(bodyText).sha256 });
			}

			if (path === "/api/email/preview" && req.method === "POST") {
				const input = (await req.json().catch(() => ({}))) as Record<
					string,
					unknown
				>;
				return json(previewStyledEmail(input));
			}

			if (path === "/api/audio-feature-reviews" && req.method === "GET") {
				return json(await audioReviewsPage(url));
			}

			const approveMatch = path.match(
				/^\/api\/audio-feature-reviews\/([0-9a-fA-F-]+)\/approve$/,
			);
			if (approveMatch && req.method === "POST") {
				const id = approveMatch[1]!;
				const body = (await req.json().catch(() => ({}))) as {
					reviewedBy?: string;
				};
				const reviewedBy = body.reviewedBy ?? "control-panel";
				return json(
					await recordAction({
						actionType: "audio-approve",
						mode: "commit",
						targetType: "audio-review",
						targetId: id,
						inputSummary: { reviewedBy },
						run: () => approveAudioReview(id, reviewedBy),
						summarize: (result) => ({ result: { ...result } }),
					}),
				);
			}

			const rejectMatch = path.match(
				/^\/api\/audio-feature-reviews\/([0-9a-fA-F-]+)\/reject$/,
			);
			if (rejectMatch && req.method === "POST") {
				const id = rejectMatch[1]!;
				const body = (await req.json().catch(() => ({}))) as {
					reviewedBy?: string;
					reason?: string;
				};
				const reviewedBy = body.reviewedBy ?? "control-panel";
				const reason = body.reason?.trim() || null;
				return json(
					await recordAction({
						actionType: "audio-reject",
						mode: "commit",
						targetType: "audio-review",
						targetId: id,
						inputSummary: { reviewedBy, reason },
						run: () => rejectAudioReview(id, reviewedBy, reason),
						summarize: (result) => ({
							result: { ...result },
							targetLabel: result.songId,
						}),
					}),
				);
			}

			const replaceMatch = path.match(
				/^\/api\/audio-feature-reviews\/([0-9a-fA-F-]+)\/replace-youtube$/,
			);
			if (replaceMatch && req.method === "POST") {
				const id = replaceMatch[1]!;
				const body = (await req.json().catch(() => ({}))) as {
					url?: string;
					reviewedBy?: string;
				};
				if (!body.url) return json({ error: "Missing url" }, 400);
				const replacementUrl = body.url;
				const reviewedBy = body.reviewedBy ?? "control-panel";
				return json(
					await recordAction({
						actionType: "audio-replace",
						mode: "commit",
						targetType: "audio-review",
						targetId: id,
						inputSummary: { reviewedBy, url: replacementUrl },
						run: () =>
							replaceAudioReviewWithYoutube(id, replacementUrl, reviewedBy),
						summarize: (result) => ({
							result: { ...result },
							externalId: result.manualJobId,
							targetLabel: result.songId,
						}),
					}),
				);
			}

			if (path === "/api/audio-feature-queue/counts" && req.method === "GET") {
				return json(
					await cached("audio-queue:counts", countAudioQueueBuckets, fresh),
				);
			}

			if (path === "/api/audio-feature-jobs" && req.method === "GET") {
				const filterParam = url.searchParams.get("filter");
				const filter: JobFilter =
					filterParam === "failed" ? "failed" : "needs_url";
				return json({ jobs: await listAudioFeatureJobs(filter) });
			}

			const submitUrlMatch = path.match(
				/^\/api\/audio-feature-jobs\/([0-9a-fA-F-]+)\/submit-url$/,
			);
			if (submitUrlMatch && req.method === "POST") {
				const id = submitUrlMatch[1]!;
				const body = (await req.json().catch(() => ({}))) as { url?: string };
				if (!body.url) return json({ error: "Missing url" }, 400);
				const submittedUrl = body.url;
				return json(
					await recordAction({
						actionType: "audio-submit-url",
						mode: "commit",
						targetType: "audio-job",
						targetId: id,
						inputSummary: { url: submittedUrl },
						run: () => submitManualUrl(id, submittedUrl),
						summarize: (result) => ({
							result: { ...result },
							externalId: result.jobId,
							targetLabel: result.songId,
						}),
					}),
				);
			}

			if (path === "/api/release-year-reviews/groups" && req.method === "GET") {
				const [page, counts] = await Promise.all([
					releaseYearGroupsPage(url),
					countReleaseYearBuckets(),
				]);
				return json({
					...page,
					pendingTotal: counts.pending,
					unresolvedTotal: counts.unresolved,
				});
			}

			// External year lookup for the albums on screen. Read-only (iTunes/Deezer
			// + local cache), so no recordAction audit entry — like the lyrics finder.
			if (
				path === "/api/release-year-reviews/candidates" &&
				req.method === "POST"
			) {
				const body = (await req.json().catch(() => ({}))) as {
					albumIds?: unknown;
				};
				return json(await yearCandidatesForAlbums(body.albumIds));
			}

			const setAlbumYearMatch = path.match(
				/^\/api\/release-year-reviews\/album\/([A-Za-z0-9]+)$/,
			);
			if (setAlbumYearMatch && req.method === "POST") {
				const albumId = setAlbumYearMatch[1]!;
				const body = (await req.json().catch(() => ({}))) as {
					year?: unknown;
				};
				return json(
					await recordAction({
						actionType: "release-year-set-album",
						mode: "commit",
						targetType: "album",
						targetId: albumId,
						inputSummary: {
							year: typeof body.year === "number" ? body.year : String(body.year),
						},
						run: () => setReleaseYearForAlbum(albumId, body.year),
						summarize: (r) => ({
							// Every affected song had a null year (the update only touches
							// null rows), so there is no previousYear and no revert path.
							result: {
								releaseYear: r.releaseYear,
								songCount: r.songCount,
							},
							targetLabel: r.albumName,
						}),
					}),
				);
			}

			if (path === "/api/release-year-reviews" && req.method === "GET") {
				const [page, counts] = await Promise.all([
					releaseYearReviewsPage(url),
					countReleaseYearBuckets(),
				]);
				return json({
					...page,
					pendingTotal: counts.pending,
					unresolvedTotal: counts.unresolved,
				});
			}

			const setYearMatch = path.match(
				/^\/api\/release-year-reviews\/([0-9a-fA-F-]+)$/,
			);
			if (setYearMatch && req.method === "POST") {
				const id = setYearMatch[1]!;
				const body = (await req.json().catch(() => ({}))) as {
					year?: unknown;
				};
				let runId: string | null = null;
				const result = await recordAction({
					actionType: "release-year-set",
					mode: "commit",
					targetType: "song",
					targetId: id,
					inputSummary: {
						year: typeof body.year === "number" ? body.year : String(body.year),
					},
					onRecorded: (recordedId) => {
						runId = recordedId;
					},
					run: () => setReleaseYear(id, body.year),
					summarize: (r) => ({
						// previousYear is recorded so History/queue can offer the bounded
						// Revert; null means it was unresolved before (not revertable —
						// the preservation trigger blocks restoring null).
						result: {
							releaseYear: r.releaseYear,
							previousYear: r.previousYear,
						},
					}),
				});
				// runId lets the queue offer an immediate 10s Revert (the same
				// precondition-guarded endpoint History uses).
				return json({ ...result, runId });
			}

			// Bounded Revert: restore the year a prior run replaced, only while the
			// current value still equals what that run wrote (revertReleaseYear
			// enforces the precondition and 409s otherwise). Logged as its own action
			// with parent_run_id pointing at the run being undone.
			const revertYearMatch = path.match(
				/^\/api\/release-year-reviews\/([0-9a-fA-F-]+)\/revert$/,
			);
			if (revertYearMatch && req.method === "POST") {
				const id = revertYearMatch[1]!;
				const body = (await req.json().catch(() => ({}))) as {
					runId?: unknown;
				};
				const runId = typeof body.runId === "string" ? body.runId : null;
				if (!runId || !isLocalStoreReady()) {
					return json(
						{ error: "A recorded set action is required to revert." },
						runId ? 503 : 400,
					);
				}
				const run = getActionRun(getLocalStore(), runId);
				const result = run?.resultSummary;
				const writtenYear =
					result && typeof result.releaseYear === "number"
						? result.releaseYear
						: null;
				const previousYear =
					result && typeof result.previousYear === "number"
						? result.previousYear
						: null;
				if (
					!run ||
					run.actionType !== "release-year-set" ||
					run.targetId !== id ||
					writtenYear === null
				) {
					return json({ error: "That action cannot be reverted." }, 409);
				}
				if (previousYear === null) {
					return json(
						{
							error:
								"The song had no prior year; it cannot be reverted to unresolved.",
						},
						409,
					);
				}
				return json(
					await recordAction({
						actionType: "release-year-revert",
						mode: "commit",
						targetType: "song",
						targetId: id,
						parentRunId: runId,
						inputSummary: { revertTo: previousYear, wasSetTo: writtenYear },
						run: () => revertReleaseYear(id, writtenYear, previousYear),
						summarize: (r) => ({ result: { releaseYear: r.releaseYear } }),
					}),
				);
			}

			if (path === "/api/lyrics-reviews" && req.method === "GET") {
				const [page, counts] = await Promise.all([
					lyricsReviewsPage(url),
					countLyricsBuckets(),
				]);
				return json({
					...page,
					needsReviewTotal: counts.needsReview,
					instrumentalTotal: counts.instrumental,
				});
			}

			// On-demand lyrics lookup so the operator never leaves the panel to find
			// lyrics. Read-only (queries LRCLIB), so no recordAction audit entry.
			const lyricsFetchMatch = path.match(
				/^\/api\/lyrics-reviews\/([0-9a-fA-F-]+)\/fetch-candidates$/,
			);
			if (lyricsFetchMatch && req.method === "GET") {
				const id = lyricsFetchMatch[1]!;
				return json(
					await lyricsCandidatesForSong(id, {
						track: url.searchParams.get("track") ?? undefined,
						artist: url.searchParams.get("artist") ?? undefined,
					}),
				);
			}

			const lyricsMatch = path.match(
				/^\/api\/lyrics-reviews\/([0-9a-fA-F-]+)\/lyrics$/,
			);
			if (lyricsMatch && req.method === "POST") {
				const id = lyricsMatch[1]!;
				const body = (await req.json().catch(() => ({}))) as {
					text?: unknown;
				};
				return json(
					await recordAction({
						actionType: "lyrics-save",
						mode: "commit",
						targetType: "song",
						targetId: id,
						// Never store the lyrics body — only its length and hash.
						inputSummary: {
							text:
								typeof body.text === "string"
									? redactText(body.text)
									: { length: 0, sha256: null },
						},
						run: () => saveManualLyrics(id, body.text),
					}),
				);
			}

			const instrumentalMatch = path.match(
				/^\/api\/lyrics-reviews\/([0-9a-fA-F-]+)\/instrumental$/,
			);
			if (instrumentalMatch && req.method === "POST") {
				const id = instrumentalMatch[1]!;
				return json(
					await recordAction({
						actionType: "lyrics-mark-instrumental",
						mode: "commit",
						targetType: "song",
						targetId: id,
						run: () => markInstrumental(id),
					}),
				);
			}

			if (path === "/api/instrumental-reviews" && req.method === "GET") {
				const [page, pendingTotal] = await Promise.all([
					instrumentalReviewsPage(url),
					countPendingInstrumentalReviews(),
				]);
				return json({ ...page, pendingTotal });
			}

			// On-demand playable sources so the operator can LISTEN to the guess
			// without leaving the panel. Read-only (stored match or yt-dlp search),
			// so no recordAction audit entry.
			const instrAudioMatch = path.match(
				/^\/api\/instrumental-reviews\/([0-9a-fA-F-]+)\/audio-sources$/,
			);
			if (instrAudioMatch && req.method === "GET") {
				return json(await audioSourcesForInstrumentalReview(instrAudioMatch[1]!));
			}

			const approveInstrMatch = path.match(
				/^\/api\/instrumental-reviews\/([0-9a-fA-F-]+)\/approve$/,
			);
			if (approveInstrMatch && req.method === "POST") {
				const id = approveInstrMatch[1]!;
				const body = (await req.json().catch(() => ({}))) as {
					reviewedBy?: string;
				};
				const reviewedBy = body.reviewedBy ?? "control-panel";
				return json(
					await recordAction({
						actionType: "instrumental-approve",
						mode: "commit",
						targetType: "instrumental-review",
						targetId: id,
						inputSummary: { reviewedBy },
						run: () => approveInstrumentalReview(id, reviewedBy),
						summarize: (result) => ({ result: { ...result } }),
					}),
				);
			}

			const rejectInstrMatch = path.match(
				/^\/api\/instrumental-reviews\/([0-9a-fA-F-]+)\/reject$/,
			);
			if (rejectInstrMatch && req.method === "POST") {
				const id = rejectInstrMatch[1]!;
				const body = (await req.json().catch(() => ({}))) as {
					reviewedBy?: string;
					reason?: string;
				};
				const reviewedBy = body.reviewedBy ?? "control-panel";
				const reason = body.reason?.trim() || null;
				return json(
					await recordAction({
						actionType: "instrumental-reject",
						mode: "commit",
						targetType: "instrumental-review",
						targetId: id,
						inputSummary: { reviewedBy, reason },
						run: () => rejectInstrumentalReview(id, reviewedBy, reason),
						summarize: (result) => ({
							result: { ...result },
							targetLabel: result.songId,
						}),
					}),
				);
			}

			if (path === "/api/email/send" && req.method === "POST") {
				const input = (await req.json().catch(() => ({}))) as Record<
					string,
					unknown
				>;
				const to = typeof input.to === "string" ? input.to : null;
				const subject = typeof input.subject === "string" ? input.subject : null;
				const templateId =
					typeof input.templateId === "string" ? input.templateId : null;
				const bodyText = typeof input.body === "string" ? input.body : "";
				let runId: string | null = null;
				const result = await recordAction({
					actionType: "email-send",
					mode: "commit",
					targetType: "email",
					targetId: to,
					targetLabel: subject,
					// Recipient/subject/template are recorded; the body never is.
					inputSummary: {
						recipient: to,
						subject,
						templateId,
						body: redactText(bodyText),
					},
					onRecorded: (recordedId) => {
						runId = recordedId;
					},
					run: async () => {
						const email = renderStyledEmail(input);
						const sent = await sendStyledEmail(email);
						return {
							ok: true,
							to: email.to,
							subject: email.subject,
							id: sent.id,
						};
					},
					summarize: (sent) => ({
						result: { to: sent.to, subject: sent.subject },
						externalId: sent.id,
					}),
				});
				return json({ ...result, runId });
			}

			return json({ error: "Not found" }, 404);
		} catch (err) {
			if (err instanceof HttpError) {
				return json({ error: err.message }, err.status);
			}
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[control-panel] ${path}:`, message);
			return json({ error: message }, 500);
		}
	},
});

console.log(`▶ control-panel API → http://localhost:${server.port}`);
try {
	console.log(`  prod ref: ${prodRef()}`);
	// Open the pooler connection now so the first dashboard load doesn't pay the
	// cold TLS handshake on top of its queries.
	void warm();
} catch (err) {
	console.error(
		`  ⚠ prod creds not resolved yet: ${err instanceof Error ? err.message : err}`,
	);
}
