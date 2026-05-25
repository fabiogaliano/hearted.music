// Test stub for the workerd-only `cloudflare:workers` module, aliased in via
// vite.config.ts during Vitest. No CF runtime exists under Node, so `env`
// exposes no bindings — `withinRateLimit`'s "binding missing" branch returns
// true (fail-open), matching local dev. Production resolves the real module.
export const env: Record<string, unknown> = {};

export function waitUntil(_promise: Promise<unknown>): void {}
