import { createFileRoute } from "@tanstack/react-router";

// Sentry tunnel: same-origin proxy that forwards browser-sent envelopes to
// Sentry's ingest endpoint. Ad-blockers block requests to *.ingest.sentry.io
// but not to our own domain, so client-side events go here first and the
// Worker forwards them server-side.
//
// Envelope format: header\npayload\n...
// Header is JSON containing { dsn, ... }. We parse it to extract the DSN host
// and project ID, then forward the raw envelope to the matching ingest URL.

const DSN_PATTERN = /^https?:\/\/[^@]+@([^/]+)\/(.+)$/;

export const Route = createFileRoute("/api/sentry-tunnel")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const body = await request.text();
				if (!body) {
					return new Response("Empty envelope", { status: 400 });
				}

				const headerLine = body.slice(0, body.indexOf("\n"));
				if (!headerLine) {
					return new Response("Malformed envelope", { status: 400 });
				}

				let dsn: string | undefined;
				try {
					const header = JSON.parse(headerLine) as { dsn?: string };
					dsn = header.dsn;
				} catch {
					return new Response("Invalid envelope header", { status: 400 });
				}

				if (!dsn) return new Response("Missing DSN", { status: 400 });

				const match = DSN_PATTERN.exec(dsn);
				if (!match) return new Response("Invalid DSN", { status: 400 });

				const [, host, projectId] = match;
				const ingestUrl = `https://${host}/api/${projectId}/envelope/`;

				const upstream = await fetch(ingestUrl, {
					method: "POST",
					body,
					headers: { "Content-Type": "application/x-sentry-envelope" },
				});

				return new Response(upstream.body, {
					status: upstream.status,
					headers: { "Content-Type": "application/json" },
				});
			},
		},
	},
});
