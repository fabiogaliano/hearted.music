/**
 * Better Auth catch-all route handler.
 *
 * Forwards all GET/POST requests under /api/auth/* to Better Auth.
 * Handles: sign-in, sign-out, callbacks, session management.
 */

import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "@/lib/platform/auth/auth";

export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET: async ({ request }: { request: Request }) => {
				return await getAuth().handler(request);
			},
			POST: async ({ request }: { request: Request }) => {
				return await getAuth().handler(request);
			},
		},
	},
});
