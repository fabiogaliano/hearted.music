/**
 * Control-panel API server (Bun).
 *
 * Local-only: serves prod metrics + operations to the Vite UI, which proxies
 * /api here. Never deployed. Reads prod creds from .env.cloud / .env, the same
 * files the supabase-prod skill uses.
 */

import {
	approveAudioReview,
	type AudioFeatureReviewRow,
	listAudioReviews,
	rejectAudioReview,
	replaceAudioReviewWithYoutube,
} from "./audio-feature-reviews";
import { cached } from "./cache";
import { prodRef, warm } from "./db";
import {
	previewStyledEmail,
	renderStyledEmail,
	sendStyledEmail,
} from "./email";
import {
	accountsByLiked,
	billingMetrics,
	enrichmentMetrics,
	jobFailures,
	jobMetrics,
	libraryMetrics,
	searchVerifiedAccounts,
	userDetail,
	usersList,
	usersMetrics,
} from "./metrics";
import { OPERATIONS, runOperation } from "./operations";

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

const METRIC_HANDLERS: Record<string, () => Promise<unknown>> = {
	users: usersMetrics,
	library: libraryMetrics,
	enrichment: enrichmentMetrics,
	jobs: jobMetrics,
	billing: billingMetrics,
};

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
				return json({ ok: true, ref: prodRef() });
			}

			const metricMatch = path.match(/^\/api\/metrics\/([a-z]+)$/);
			if (metricMatch && req.method === "GET") {
				const name = metricMatch[1]!;
				const handler = METRIC_HANDLERS[name];
				if (!handler) return json({ error: "Unknown metric" }, 404);
				return json(await cached(`metric:${name}`, handler, fresh));
			}

			if (path === "/api/jobs/failures" && req.method === "GET") {
				return json({
					failures: await cached("jobs:failures", jobFailures, fresh),
				});
			}

			if (path === "/api/users/list" && req.method === "GET") {
				return json({ users: await cached("users:list", usersList, fresh) });
			}

			if (path === "/api/accounts/search" && req.method === "GET") {
				const q = url.searchParams.get("q") ?? "";
				return json({ accounts: await searchVerifiedAccounts(q) });
			}

			if (path === "/api/accounts/by-liked" && req.method === "GET") {
				const min = Number(url.searchParams.get("min") ?? "0");
				const maxRaw = url.searchParams.get("max");
				const max = maxRaw == null || maxRaw === "" ? null : Number(maxRaw);
				return json({
					accounts: await cached(
						`accounts:by-liked:${min}:${max}`,
						() => accountsByLiked(min, max),
						fresh,
					),
				});
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

			const opMatch = path.match(/^\/api\/operations\/([a-z-]+)$/);
			if (opMatch && req.method === "POST") {
				const input = (await req.json().catch(() => ({}))) as Record<
					string,
					unknown
				>;
				return json(await runOperation(opMatch[1]!, input));
			}

			// Live composer preview — lenient render, never sends, never throws on
			// half-typed input (so the iframe updates on every keystroke).
			if (path === "/api/email/preview" && req.method === "POST") {
				const input = (await req.json().catch(() => ({}))) as Record<
					string,
					unknown
				>;
				return json(previewStyledEmail(input));
			}

			if (path === "/api/audio-feature-reviews" && req.method === "GET") {
				const statusParam = url.searchParams.get("status") ?? "pending";
				const status: AudioFeatureReviewRow["status"] =
					statusParam === "approved" || statusParam === "rejected"
						? statusParam
						: "pending";
				return json({ reviews: await listAudioReviews(status) });
			}

			const approveMatch = path.match(
				/^\/api\/audio-feature-reviews\/([0-9a-fA-F-]+)\/approve$/,
			);
			if (approveMatch && req.method === "POST") {
				const body = (await req.json().catch(() => ({}))) as {
					reviewedBy?: string;
				};
				return json(
					await approveAudioReview(
						approveMatch[1]!,
						body.reviewedBy ?? "control-panel",
					),
				);
			}

			const rejectMatch = path.match(
				/^\/api\/audio-feature-reviews\/([0-9a-fA-F-]+)\/reject$/,
			);
			if (rejectMatch && req.method === "POST") {
				const body = (await req.json().catch(() => ({}))) as {
					reviewedBy?: string;
					reason?: string;
				};
				return json(
					await rejectAudioReview(
						rejectMatch[1]!,
						body.reviewedBy ?? "control-panel",
						body.reason?.trim() || null,
					),
				);
			}

			const replaceMatch = path.match(
				/^\/api\/audio-feature-reviews\/([0-9a-fA-F-]+)\/replace-youtube$/,
			);
			if (replaceMatch && req.method === "POST") {
				const body = (await req.json().catch(() => ({}))) as {
					url?: string;
					reviewedBy?: string;
				};
				if (!body.url) return json({ error: "Missing url" }, 400);
				return json(
					await replaceAudioReviewWithYoutube(
						replaceMatch[1]!,
						body.url,
						body.reviewedBy ?? "control-panel",
					),
				);
			}

			if (path === "/api/email/send" && req.method === "POST") {
				const input = (await req.json().catch(() => ({}))) as Record<
					string,
					unknown
				>;
				const email = renderStyledEmail(input);
				const sent = await sendStyledEmail(email);
				return json({
					ok: true,
					to: email.to,
					subject: email.subject,
					id: sent.id,
				});
			}

			return json({ error: "Not found" }, 404);
		} catch (err) {
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
