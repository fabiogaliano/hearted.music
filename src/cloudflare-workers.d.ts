// Minimal ambient declaration for the CF Workers runtime module. The full
// @cloudflare/workers-types package isn't installed; this shim covers the one
// API we use (`waitUntil`) so server code that opportunistically imports
// "cloudflare:workers" stays type-safe.
declare module "cloudflare:workers" {
	export function waitUntil(promise: Promise<unknown>): void;
}
