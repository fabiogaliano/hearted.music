/// <reference types="bun" />
import path from "node:path";
import * as Sentry from "@sentry/bun";

// Production HTTP server: `bun --preload ./src/instrument.ts src/serve.ts`
// after `vite build`. Start's server bundle only renders and runs server fns,
// so this also serves dist/client and adds the headers every response needs.

const distDir = path.resolve(import.meta.dir, "../dist");
const clientDir = path.join(distDir, "client");

const SECURITY_HEADERS = {
	"Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
	"Permissions-Policy":
		"camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

interface ServerBundle {
	default: { fetch(request: Request): Response | Promise<Response> };
	drainServerWork(): Promise<void>;
}

const bundle: ServerBundle = await import(
	path.join(distDir, "server/server.js")
);

async function serveClientFile(pathname: string): Promise<Response | null> {
	const filePath = path.join(clientDir, decodeURIComponent(pathname));
	if (!filePath.startsWith(`${clientDir}/`)) return null;

	const file = Bun.file(filePath);
	if (!(await file.exists())) return null;

	// Vite content-hashes everything under /assets; other public files keep
	// their names across deploys, so they may only be cached briefly.
	const cacheControl = pathname.startsWith("/assets/")
		? "public, max-age=31536000, immutable"
		: "public, max-age=3600";
	return new Response(file, { headers: { "Cache-Control": cacheControl } });
}

function withSecurityHeaders(response: Response): Response {
	// Copied because some responses (e.g. Response.redirect) have immutable headers.
	const headers = new Headers(response.headers);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		headers.set(name, value);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

const server = Bun.serve({
	port: Number(process.env.PORT ?? 3000),
	// Bun's 10 s default would cut off slow server fns and streamed SSR
	// responses mid-flight.
	idleTimeout: 120,
	async fetch(request) {
		const isRead = request.method === "GET" || request.method === "HEAD";
		const staticResponse = isRead
			? await serveClientFile(new URL(request.url).pathname)
			: null;
		return withSecurityHeaders(
			staticResponse ?? (await bundle.default.fetch(request)),
		);
	},
});

console.log(`[serve] listening on ${server.url}`);

async function shutdown(): Promise<void> {
	await server.stop();
	await bundle.drainServerWork();
	await Sentry.flush(2000);
	process.exit(0);
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
