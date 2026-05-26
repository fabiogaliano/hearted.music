/**
 * Ladle stub for @/lib/platform/auth/auth.middleware.
 *
 * The real `.server()` body calls getAuthSession() → better-auth, whose crypto
 * module references the Node `Buffer` global and crashes the browser bundle.
 * Every server function attaches this middleware, so stubbing it here cuts the
 * better-auth graph out of Ladle for all of them at once. Handlers are RPC
 * callers that never execute in Ladle, so the no-op server body is never run.
 */

import { createMiddleware } from "@tanstack/react-start";

export const authMiddleware = createMiddleware({ type: "function" }).server(
	({ next }) => next({ context: { session: undefined, account: undefined } }),
);
