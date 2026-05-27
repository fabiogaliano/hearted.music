import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = {
	GEMINI_API_KEY: undefined as string | undefined,
	GOOGLE_GENERATIVE_AI_API_KEY: undefined as string | undefined,
	GOOGLE_API_KEY: undefined as string | undefined,
	ANTHROPIC_API_KEY: undefined as string | undefined,
	OPENAI_API_KEY: undefined as string | undefined,
	GOOGLE_VERTEX_PROJECT: undefined as string | undefined,
	GOOGLE_VERTEX_LOCATION: undefined as string | undefined,
	GOOGLE_APPLICATION_CREDENTIALS_JSON: undefined as string | undefined,
};

vi.mock("@/env", () => ({
	env: new Proxy(
		{},
		{
			get: (_target, prop) => {
				if (typeof prop !== "string") return undefined;
				return mockEnv[prop as keyof typeof mockEnv];
			},
		},
	),
}));

import { getApiKeyForProvider, resolveLlmConfig } from "../config";

describe("llm config resolution", () => {
	beforeEach(() => {
		mockEnv.GEMINI_API_KEY = undefined;
		mockEnv.GOOGLE_GENERATIVE_AI_API_KEY = undefined;
		mockEnv.GOOGLE_API_KEY = undefined;
		mockEnv.ANTHROPIC_API_KEY = undefined;
		mockEnv.OPENAI_API_KEY = undefined;
		mockEnv.GOOGLE_VERTEX_PROJECT = undefined;
		mockEnv.GOOGLE_VERTEX_LOCATION = undefined;
		mockEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON = undefined;
	});

	it("treats vertex as configured when the project is set", () => {
		mockEnv.GOOGLE_VERTEX_PROJECT = "hearted-prod";
		mockEnv.GOOGLE_VERTEX_LOCATION = "europe-west1";
		const credentials = {
			type: "service_account",
			project_id: "hearted-prod",
			private_key_id: "key-id",
			private_key:
				"-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
			client_email: "vertex@hearted-prod.iam.gserviceaccount.com",
			client_id: "1234567890",
		};
		mockEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON = JSON.stringify(credentials);

		const result = resolveLlmConfig("google-vertex");

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.config).toMatchObject({
			provider: "google-vertex",
			project: "hearted-prod",
			location: "europe-west1",
		});
		if (!("credentials" in result.config)) {
			throw new Error("Expected vertex credentials to be present");
		}
		expect(result.config.credentials).toEqual(
			expect.objectContaining({
				project_id: "hearted-prod",
				client_email: "vertex@hearted-prod.iam.gserviceaccount.com",
			}),
		);
	});

	it("returns a config error for malformed inline credentials", () => {
		mockEnv.GOOGLE_VERTEX_PROJECT = "hearted-prod";
		mockEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON = "{not-json";

		const result = resolveLlmConfig("google-vertex");

		expect(result).toEqual({
			ok: false,
			reason:
				"GOOGLE_APPLICATION_CREDENTIALS_JSON is set but is not valid JSON.",
		});
	});

	it("still resolves api-key providers from the existing fallback chain", () => {
		mockEnv.GEMINI_API_KEY = "gemini-key";

		expect(getApiKeyForProvider("google")).toBe("gemini-key");
	});
});
