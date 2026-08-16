import { describe, expect, it, vi } from "vitest";

vi.mock("../prod-creds", () => ({
	getPostHogCreds: () => ({
		apiKey: null,
		projectId: "185471",
		apiHost: "https://eu.posthog.com",
	}),
}));

import { postHogSourceStatus } from "../posthog";

describe("posthog adapter", () => {
	it("returns unconfigured status when API key is missing", async () => {
		const status = await postHogSourceStatus();
		expect(status.status).toBe("unconfigured");
	});
});
