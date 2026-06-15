/**
 * Control-panel API server (Bun).
 *
 * Local-only: serves prod metrics + operations to the Vite UI, which proxies
 * /api here. Never deployed. Reads prod creds from .env.cloud / .env, the same
 * files the supabase-prod skill uses.
 */

import { prodRef } from "./db";
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

		if (req.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS });
		}

		try {
			if (path === "/api/health") {
				return json({ ok: true, ref: prodRef() });
			}

			const metricMatch = path.match(/^\/api\/metrics\/([a-z]+)$/);
			if (metricMatch && req.method === "GET") {
				const handler = METRIC_HANDLERS[metricMatch[1]!];
				if (!handler) return json({ error: "Unknown metric" }, 404);
				return json(await handler());
			}

			if (path === "/api/jobs/failures" && req.method === "GET") {
				return json({ failures: await jobFailures() });
			}

			if (path === "/api/users/list" && req.method === "GET") {
				return json({ users: await usersList() });
			}

			if (path === "/api/accounts/search" && req.method === "GET") {
				const q = url.searchParams.get("q") ?? "";
				return json({ accounts: await searchVerifiedAccounts(q) });
			}

			if (path === "/api/accounts/by-liked" && req.method === "GET") {
				const min = Number(url.searchParams.get("min") ?? "0");
				const maxRaw = url.searchParams.get("max");
				const max = maxRaw == null || maxRaw === "" ? null : Number(maxRaw);
				return json({ accounts: await accountsByLiked(min, max) });
			}

			const userMatch = path.match(/^\/api\/users\/([0-9a-fA-F-]+)$/);
			if (userMatch && req.method === "GET") {
				const detail = await userDetail(userMatch[1]!);
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
} catch (err) {
	console.error(
		`  ⚠ prod creds not resolved yet: ${err instanceof Error ? err.message : err}`,
	);
}
