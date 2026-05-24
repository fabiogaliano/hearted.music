import { describe, expect, it } from "vitest";
import { resolvePostHogHosts } from "@/lib/observability/posthog-hosts";

describe("resolvePostHogHosts", () => {
	it("falls back to the default EU hosts in non-strict mode", () => {
		const resolution = resolvePostHogHosts("https://us.i.posthog.com", {
			strict: false,
		});

		expect(resolution).toEqual({
			kind: "ok",
			value: {
				apiHost: "https://eu.i.posthog.com",
				assetHost: "https://eu-assets.i.posthog.com",
				uiHost: "https://eu.posthog.com",
			},
		});
	});

	it("keeps prod strict validation", () => {
		const resolution = resolvePostHogHosts("https://us.i.posthog.com", {
			strict: true,
		});

		expect(resolution).toEqual({
			kind: "invalid",
			reason:
				"hearted is configured for PostHog EU only. Use https://eu.i.posthog.com.",
		});
	});
});
