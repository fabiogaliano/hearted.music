// Minimal ambient declaration for the CF Workers runtime module. The full
// @cloudflare/workers-types package isn't installed; this shim covers the
// APIs we use so server code that opportunistically imports
// "cloudflare:workers" stays type-safe.
declare module "cloudflare:workers" {
	export function waitUntil(promise: Promise<unknown>): void;
	// Runtime bindings injected by workerd (rate-limit bindings, etc.). Typed
	// loosely because we have no generated worker types; callers narrow.
	export const env: Record<string, unknown>;
}
