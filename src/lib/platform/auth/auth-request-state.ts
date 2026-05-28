import { createMiddleware, getGlobalStartContext } from "@tanstack/react-start";
import type {
	AuthRequestState,
	BetterAuthInstance,
} from "./auth-request-state.server";

export type { AuthRequestState, BetterAuthInstance };

// Server-only impl is dynamically imported so postgres/better-auth/drizzle never
// reach the client bundle: start-compiler strips this whole .server() callback
// on the client, and Vite dev does not tree-shake top-level imports.
export const authRequestMiddleware = createMiddleware().server(
	async ({ next }) => {
		const { createAuthRequestState, closeAuthRequestAfterResponse } =
			await import("./auth-request-state.server");
		const authRequest = createAuthRequestState();

		try {
			return await next({ context: { authRequest } });
		} finally {
			await closeAuthRequestAfterResponse(authRequest);
		}
	},
);

export function getAuthRequestState(): AuthRequestState {
	const context = getGlobalStartContext();

	if (!context?.authRequest) {
		throw new Error(
			"Auth request context unavailable. Add authRequestMiddleware to src/start.ts and call auth helpers only within the TanStack Start request lifecycle.",
		);
	}

	return context.authRequest;
}
