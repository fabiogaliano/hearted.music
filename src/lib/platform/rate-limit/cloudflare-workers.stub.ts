// Stands in for workerd's `cloudflare:workers` (aliased in vite.config.ts) so
// edge-rate-limit.ts still resolves in Vite dev, tests and the build until it
// moves to an in-process limiter (reliability plan §3d). No bindings, so
// `withinRateLimit` fails open, as it would on Bun anyway.
export const env: Record<string, unknown> = {};
