import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// TanStack's route option types don't expose `headers` callably; cast to the
// shape we invoke.
type RootHeaders = (ctx: {
	ssr?: { nonce?: string };
}) => Record<string, string>;

function connectSrcOf(csp: string): string[] {
	const directive = csp
		.split(";")
		.map((part) => part.trim())
		.find((part) => part.startsWith("connect-src "));
	return directive?.split(" ").slice(1) ?? [];
}

async function loadRootHeaders(): Promise<RootHeaders> {
	vi.resetModules();
	const { Route } = await import("../__root");
	return (Route.options as unknown as { headers: RootHeaders }).headers;
}

describe("root CSP", () => {
	beforeEach(() => {
		vi.stubEnv("DEV", false);
		vi.stubEnv("PROD", true);
		vi.stubEnv("VITE_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_test");
		vi.stubEnv(
			"VITE_ACCOUNT_EVENTS_GATEWAY_URL",
			"https://events.example.test/base",
		);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it.each([
		["nonce", { ssr: { nonce: "abc" } }],
		["no-nonce", {}],
	])("allows connecting to the account-events gateway origin (%s variant) — SSE was blocked in prod", async (_variant, ctx) => {
		const headers = await loadRootHeaders();

		const connectSrc = connectSrcOf(headers(ctx)["Content-Security-Policy"]);

		expect(connectSrc).toContain("https://events.example.test");
	});
});
