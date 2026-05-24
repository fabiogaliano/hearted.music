import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env";
import {
	getPostHogProxyUpstreamUrl,
	POSTHOG_TUNNEL_PATH,
	resolvePostHogHosts,
} from "@/lib/observability/posthog-hosts";

const UPSTREAM_TIMEOUT_MS = 15_000;

type StreamingRequestInit = RequestInit & {
	duplex: "half";
};

class InvalidPostHogConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidPostHogConfigError";
	}
}

function getUpstreamRequestUrl(request: Request): string {
	const url = new URL(request.url);
	const upstreamPath = url.pathname.slice(POSTHOG_TUNNEL_PATH.length) || "/";
	const resolvedHosts = resolvePostHogHosts(env.VITE_PUBLIC_POSTHOG_HOST, {
		strict: import.meta.env.PROD,
	});
	if (resolvedHosts.kind === "invalid") {
		throw new InvalidPostHogConfigError(resolvedHosts.reason);
	}
	return getPostHogProxyUpstreamUrl(
		resolvedHosts.value,
		upstreamPath,
		url.search,
	);
}

function createUpstreamRequest(request: Request): RequestInit {
	const headers = new Headers(request.headers);
	headers.delete("host");
	headers.delete("content-length");

	const baseRequest: RequestInit = {
		method: request.method,
		headers,
		redirect: "manual",
	};

	if (!request.body) {
		return baseRequest;
	}

	const streamingRequest: StreamingRequestInit = {
		...baseRequest,
		body: request.body,
		duplex: "half",
	};

	return streamingRequest;
}

async function forwardRequest(request: Request): Promise<Response> {
	const abortController = new AbortController();
	const timeoutId = setTimeout(() => {
		abortController.abort();
	}, UPSTREAM_TIMEOUT_MS);

	try {
		const upstream = await fetch(getUpstreamRequestUrl(request), {
			...createUpstreamRequest(request),
			signal: abortController.signal,
		});
		return new Response(upstream.body, {
			status: upstream.status,
			headers: upstream.headers,
		});
	} catch (error) {
		if (error instanceof InvalidPostHogConfigError) {
			console.error(
				`[posthog-tunnel] Invalid VITE_PUBLIC_POSTHOG_HOST configuration: ${error.message}`,
			);
			return new Response("PostHog tunnel misconfigured", { status: 500 });
		}
		if (abortController.signal.aborted) {
			return new Response("Timed out sending request to PostHog", {
				status: 504,
			});
		}
		console.error("[posthog-tunnel] Failed to forward request", error);
		return new Response("Failed to reach PostHog upstream", { status: 502 });
	} finally {
		clearTimeout(timeoutId);
	}
}

export const Route = createFileRoute("/api/posthog/$")({
	server: {
		handlers: {
			GET: async ({ request }) => forwardRequest(request),
			POST: async ({ request }) => forwardRequest(request),
		},
	},
});
