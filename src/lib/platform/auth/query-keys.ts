/**
 * Cache keys for the auth-layer queries owned by the authenticated layout
 * (src/routes/_authenticated/route.tsx seeds both in beforeLoad).
 *
 * Server-result handlers patch these caches optimistically after mutations;
 * a typo'd literal would silently patch a key nobody reads, so every consumer
 * must import from here instead of re-declaring the literals.
 */
export const AUTH_SESSION_QUERY_KEY = ["auth", "session"] as const;

export const ONBOARDING_SESSION_QUERY_KEY = [
	"auth",
	"onboarding-session",
] as const;
