import { createFileRoute } from "@tanstack/react-router";
import { clientEnv } from "@/env.public";

// Shallow liveness probe for uptime monitors. Intentionally checks nothing
// downstream: a DB ping per probe would open a Postgres connection on every
// poll (the per-request exhaustion class C2 fixed) and couple uptime alerts to
// DB health. If the SSR worker can run this handler, it is serving.
export const Route = createFileRoute("/health")({
	server: {
		handlers: {
			GET: () =>
				Response.json({
					status: "ok",
					release: clientEnv.VITE_APP_RELEASE ?? null,
				}),
		},
	},
});
