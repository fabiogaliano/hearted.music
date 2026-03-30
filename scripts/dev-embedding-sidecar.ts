/// <reference types="bun" />

/**
 * Local embedding sidecar server for development.
 *
 * Wraps LocalProvider's ONNX inference in a Bun HTTP server so that
 * Workerd-based dev servers (TanStack Start / Cloudflare Vite plugin)
 * can use local embeddings via HTTP fallback.
 *
 * Usage: bun scripts/dev-embedding-sidecar.ts
 *        bun run dev:embeddings
 */

import { Result } from "better-result";
import { LocalProvider } from "@/lib/integrations/providers/adapters/local";

const PORT = Number(process.env.EMBEDDING_SERVER_PORT) || 9847;

const provider = new LocalProvider({ forceDirect: true });
const metadata = provider.getMetadata();

const server = Bun.serve({
	port: PORT,
	async fetch(req: Request) {
		const url = new URL(req.url);

		if (req.method === "GET" && url.pathname === "/health") {
			return Response.json({ status: "ok", metadata });
		}

		if (req.method === "POST" && url.pathname === "/embed") {
			const body = await req.json();
			const result = await provider.embed(body.text, body.options);
			return unwrapResult(result);
		}

		if (req.method === "POST" && url.pathname === "/embed-batch") {
			const body = await req.json();
			const result = await provider.embedBatch(body.texts, body.options);
			if (Result.isError(result)) {
				return errorResponse(result.error);
			}
			return Response.json({ results: result.value });
		}

		if (req.method === "POST" && url.pathname === "/rerank") {
			const body = await req.json();
			const result = await provider.rerank(
				body.query,
				body.documents,
				body.options,
			);
			return unwrapResult(result);
		}

		return Response.json({ error: "Not found" }, { status: 404 });
	},
});

function unwrapResult(result: Result<unknown, { message: string; _tag: string }>) {
	if (Result.isError(result)) {
		return errorResponse(result.error);
	}
	return Response.json(result.value);
}

function errorResponse(error: { message: string; _tag: string }) {
	return Response.json(
		{ error: error.message, tag: error._tag },
		{ status: 500 },
	);
}

console.log(`[Embedding Sidecar] Running on http://127.0.0.1:${server.port}`);
console.log(`[Embedding Sidecar] Model: ${metadata.embeddingModel} (${metadata.embeddingDims}d)`);
if (metadata.rerankerModel) {
	console.log(`[Embedding Sidecar] Reranker: ${metadata.rerankerModel}`);
}
