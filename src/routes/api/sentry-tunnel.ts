import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env";

// Sentry tunnel: same-origin proxy that forwards browser-sent envelopes to
// one configured Sentry project. Ad-blockers block requests to
// *.ingest.sentry.io but not to our own domain, so client-side events go here
// first and the Worker forwards them server-side.

// Sentry browser envelopes are usually far smaller; this cap rejects abuse
// cheaply without blocking normal error and replay traffic.
const MAX_ENVELOPE_BYTES = 200_000;
const textDecoder = new TextDecoder();

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

function getEnvelopeDsn(body: string): string | Response {
	const newlineIndex = body.indexOf("\n");
	if (newlineIndex <= 0) {
		return new Response("Malformed envelope", { status: 400 });
	}

	const headerLine = body.slice(0, newlineIndex).replace(/\r$/, "");

	let parsedHeader: unknown;
	try {
		parsedHeader = JSON.parse(headerLine);
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

export const Route = createFileRoute("/api/sentry-tunnel")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				if (tunnelConfig.kind === "disabled") {
					return new Response("Sentry tunnel disabled", { status: 404 });
				}

				if (tunnelConfig.kind === "invalid") {
					console.error(
						`[sentry-tunnel] Invalid VITE_SENTRY_DSN configuration: ${tunnelConfig.reason}`,
					);
					return new Response("Sentry tunnel misconfigured", { status: 500 });
				}

				const contentLengthHeader = request.headers.get("content-length");
				if (contentLengthHeader) {
					const contentLength = Number.parseInt(contentLengthHeader, 10);
					if (
						Number.isFinite(contentLength) &&
						contentLength > MAX_ENVELOPE_BYTES
					) {
						return new Response("Payload too large", { status: 413 });
					}
				}

				const bodyBytes = await request.arrayBuffer();
				if (bodyBytes.byteLength === 0) {
					return new Response("Empty envelope", { status: 400 });
				}

				if (bodyBytes.byteLength > MAX_ENVELOPE_BYTES) {
					return new Response("Payload too large", { status: 413 });
				}

				const body = textDecoder.decode(bodyBytes);
				const envelopeDsn = getEnvelopeDsn(body);
				if (envelopeDsn instanceof Response) {
					return envelopeDsn;
				}

				const parsedEnvelopeDsn = parseSentryDsn(envelopeDsn);
				if (parsedEnvelopeDsn.kind === "invalid") {
					return new Response(parsedEnvelopeDsn.reason, { status: 400 });
				}

				if (
					parsedEnvelopeDsn.value.host !== tunnelConfig.host ||
					parsedEnvelopeDsn.value.pathPrefix !== tunnelConfig.pathPrefix ||
					parsedEnvelopeDsn.value.projectId !== tunnelConfig.projectId
				) {
					return new Response("DSN not allowed", { status: 403 });
				}

				const upstream = await fetch(tunnelConfig.ingestUrl, {
					method: "POST",
					body: bodyBytes,
					headers: { "Content-Type": "application/x-sentry-envelope" },
				});

				return new Response(upstream.body, {
					status: upstream.status,
					headers: {
						"Content-Type":
							upstream.headers.get("Content-Type") ?? "application/json",
					},
				});
			},
		},
	},
});
