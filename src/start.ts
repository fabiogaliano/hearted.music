import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { authRequestMiddleware } from "@/lib/platform/auth/auth-request-state";

// Defining src/start.ts opts out of the CSRF middleware Start installs by
// default, so we re-add it explicitly. It validates Sec-Fetch-Site/Origin/Referer
// on serverFn requests only (handlerType filter), leaving SSR document/loader
// requests untouched. SameSite=lax cookies remain the first line of defense;
// this adds same-site/sibling-origin coverage that SameSite cannot express.
// CSRF runs before auth so cross-site requests are rejected before we open a
// per-request DB connection.
const csrfMiddleware = createCsrfMiddleware({
	filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
	requestMiddleware: [csrfMiddleware, authRequestMiddleware],
}));
