import { createStart } from "@tanstack/react-start";
import { authRequestMiddleware } from "@/lib/platform/auth/auth-request-state";

// CSRF protection is handled outside TanStack Start's middleware (see notes in
// vite.config.ts where `disableCsrfMiddlewareWarning` is set). We rely on
// SameSite=lax session cookies and Better Auth's originCheckMiddleware, both
// audited and accepted by the 2026-05 pre-launch security review.
export const startInstance = createStart(() => ({
	requestMiddleware: [authRequestMiddleware],
}));
