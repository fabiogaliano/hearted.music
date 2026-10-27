// Kept only so edge-rate-limit.ts compiles until it moves to an in-process
// limiter (reliability plan §3d); the module resolves to the sibling stub.
declare module "cloudflare:workers" {
	export const env: Record<string, unknown>;
}
