import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env";
import {
	clientIpFrom,
	withinRateLimit,
} from "@/lib/platform/rate-limit/edge-rate-limit";

// Sentry tunnel: same-origin proxy that forwards browser-sent envelopes to
// one configured Sentry project. Ad-blockers block requests to
// *.ingest.sentry.io but not to our own domain, so client-side events go here
// first and the Worker forwards them server-side.

const MAX_ENVELOPE_BYTES = 15 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;
const textDecoder = new TextDecoder();

class PayloadTooLargeError extends Error {
	constructor() {
		super("Payload too large");
		this.name = "PayloadTooLargeError";
	}
}

type StreamingRequestInit = RequestInit & {
	duplex: "half";
};

type ValidSentryDsn = {
	host: string;
	pathPrefix: string;
	projectId: string;
	ingestUrl: string;
};

type ParsedSentryDsn =
	| {
			kind: "ok";
			value: ValidSentryDsn;
	  }
	| {
			kind: "invalid";
			reason: string;
	  };

type TunnelConfig =
	| {
			kind: "disabled";
	  }
	| {
			kind: "invalid";
			reason: string;
	  }
	| ({
			kind: "enabled";
	  } & ValidSentryDsn);

type EnvelopeStreamResult =
	| {
			kind: "ok";
			dsn: string;
			body: ReadableStream<Uint8Array>;
	  }
	| {
			kind: "response";
			response: Response;
	  };

type ForwardResult =
	| {
			kind: "ok";
			upstream: Response;
	  }
	| {
			kind: "payload-too-large";
	  }
	| {
			kind: "timeout";
	  }
	| {
			kind: "network-error";
			error: unknown;
	  };

const tunnelConfig = createTunnelConfig(env.VITE_SENTRY_DSN);

function parseSentryDsn(dsn: string): ParsedSentryDsn {
	let url: URL;
	try {
		url = new URL(dsn);
	} catch {
		return { kind: "invalid", reason: "Invalid DSN" };
	}

	if (!url.username) {
		return { kind: "invalid", reason: "Invalid DSN" };
	}

	const pathSegments = url.pathname
		.replace(/\/+$/, "")
		.split("/")
		.filter((segment) => segment.length > 0);
	const projectId = pathSegments.at(-1);
	if (!projectId) {
		return { kind: "invalid", reason: "Invalid DSN" };
	}

	const pathPrefix = pathSegments.slice(0, -1).join("/");
	const ingestPath = pathPrefix
		? `/${pathPrefix}/api/${projectId}/envelope/`
		: `/api/${projectId}/envelope/`;

	return {
		kind: "ok",
		value: {
			host: url.host,
			pathPrefix,
			projectId,
			ingestUrl: `${url.protocol}//${url.host}${ingestPath}`,
		},
	};
}

function createTunnelConfig(dsn: string | undefined): TunnelConfig {
	if (!dsn) {
		return { kind: "disabled" };
	}

	const parsed = parseSentryDsn(dsn);
	if (parsed.kind === "invalid") {
		return parsed;
	}

	return { kind: "enabled", ...parsed.value };
}

function getEnvelopeDsn(headerLine: string): string | Response {
	let parsedHeader: unknown;
	try {
		parsedHeader = JSON.parse(headerLine.replace(/\r$/, ""));
	} catch {
		return new Response("Invalid envelope header", { status: 400 });
	}

	if (typeof parsedHeader !== "object" || parsedHeader === null) {
		return new Response("Invalid envelope header", { status: 400 });
	}

	const dsn = Reflect.get(parsedHeader, "dsn");
	if (typeof dsn !== "string" || dsn.length === 0) {
		return new Response("Missing DSN", { status: 400 });
	}

	return dsn;
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
	const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const combined = new Uint8Array(totalLength);
	let offset = 0;

	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return combined;
}

function cancelStream(stream: ReadableStream<Uint8Array>): void {
	void stream.cancel().catch(() => {
		// Ignore cancellation failures; the request is already being rejected.
	});
}

function capEnvelopeBody(
	body: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
	let totalBytes = 0;

	return body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				totalBytes += chunk.byteLength;
				if (totalBytes > MAX_ENVELOPE_BYTES) {
					controller.error(new PayloadTooLargeError());
					return;
				}

				controller.enqueue(chunk);
			},
		}),
	);
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

async function forwardEnvelope(
	ingestUrl: string,
	body: ReadableStream<Uint8Array>,
): Promise<ForwardResult> {
	const abortController = new AbortController();
	const timeoutId = setTimeout(() => {
		abortController.abort();
	}, UPSTREAM_TIMEOUT_MS);

	try {
		const upstreamRequest: StreamingRequestInit = {
			method: "POST",
			body: capEnvelopeBody(body),
			headers: { "Content-Type": "application/x-sentry-envelope" },
			duplex: "half",
			signal: abortController.signal,
		};

		const upstream = await fetch(ingestUrl, upstreamRequest);
		return { kind: "ok", upstream };
	} catch (error) {
		if (error instanceof PayloadTooLargeError) {
			return { kind: "payload-too-large" };
		}
		if (abortController.signal.aborted || isAbortError(error)) {
			return { kind: "timeout" };
		}
		return { kind: "network-error", error };
	} finally {
		clearTimeout(timeoutId);
	}
}

async function readEnvelopeStream(
	request: Request,
): Promise<EnvelopeStreamResult> {
	if (!request.body) {
		return {
			kind: "response",
			response: new Response("Empty envelope", { status: 400 }),
		};
	}

	const [validationBody, upstreamBody] = request.body.tee();
	const reader = validationBody.getReader();
	const headerChunks: Uint8Array[] = [];
	let sawAnyBytes = false;

	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			cancelStream(upstreamBody);
			return {
				kind: "response",
				response: new Response(
					sawAnyBytes ? "Malformed envelope" : "Empty envelope",
					{ status: 400 },
				),
			};
		}

		if (value.byteLength === 0) {
			continue;
		}

		sawAnyBytes = true;
		const newlineIndex = value.indexOf(10);
		if (newlineIndex === -1) {
			headerChunks.push(value);
			continue;
		}

		headerChunks.push(value.subarray(0, newlineIndex));
		break;
	}

	void reader.cancel().catch(() => {
		// The forwarding branch owns the underlying body once validation succeeds.
	});
	const dsn = getEnvelopeDsn(
		textDecoder.decode(concatUint8Arrays(headerChunks)),
	);
	if (dsn instanceof Response) {
		cancelStream(upstreamBody);
		return { kind: "response", response: dsn };
	}

	return { kind: "ok", dsn, body: upstreamBody };
}

export const Route = createFileRoute("/api/pulse-s")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				try {
					if (tunnelConfig.kind === "disabled") {
						return new Response("Sentry tunnel disabled", { status: 404 });
					}

					if (tunnelConfig.kind === "invalid") {
						console.error(
							`[sentry-tunnel] Invalid VITE_SENTRY_DSN configuration: ${tunnelConfig.reason}`,
						);
						return new Response("Sentry tunnel misconfigured", { status: 500 });
					}

					if (
						!(await withinRateLimit(
							"SENTRY_TUNNEL_LIMITER",
							clientIpFrom(request),
						))
					) {
						return new Response("Too Many Requests", {
							status: 429,
							headers: { "retry-after": "60" },
						});
					}

					const envelope = await readEnvelopeStream(request);
					if (envelope.kind === "response") {
						return envelope.response;
					}

					const parsedEnvelopeDsn = parseSentryDsn(envelope.dsn);
					if (parsedEnvelopeDsn.kind === "invalid") {
						return new Response(parsedEnvelopeDsn.reason, { status: 400 });
					}

					if (
						parsedEnvelopeDsn.value.host !== tunnelConfig.host ||
						parsedEnvelopeDsn.value.pathPrefix !== tunnelConfig.pathPrefix ||
						parsedEnvelopeDsn.value.projectId !== tunnelConfig.projectId
					) {
						cancelStream(envelope.body);
						return new Response("DSN not allowed", { status: 403 });
					}

					const forwardResult = await forwardEnvelope(
						tunnelConfig.ingestUrl,
						envelope.body,
					);
					if (forwardResult.kind === "payload-too-large") {
						return new Response("Payload too large", { status: 413 });
					}
					if (forwardResult.kind === "timeout") {
						return new Response("Timed out sending envelope to Sentry", {
							status: 504,
						});
					}
					if (forwardResult.kind === "network-error") {
						throw forwardResult.error;
					}

					return new Response(forwardResult.upstream.body, {
						status: forwardResult.upstream.status,
						headers: {
							"Content-Type":
								forwardResult.upstream.headers.get("Content-Type") ??
								"application/json",
						},
					});
				} catch (error) {
					console.error("[sentry-tunnel] Failed to forward envelope", error);
					try {
						const { captureException } = await import("@sentry/cloudflare");
						captureException(error, { tags: { source: "sentry-tunnel" } });
					} catch {}
					return new Response("Failed to reach Sentry ingest", { status: 502 });
				}
			},
		},
	},
});
