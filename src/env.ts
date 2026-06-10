import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const boolString = z
	.enum(["true", "false"])
	.default("false")
	.transform((v) => v === "true");

/**
 * Safe access to process.env - returns undefined on client where process doesn't exist.
 * This is needed because runtimeEnv is evaluated at module load time.
 */
const serverEnv =
	typeof process !== "undefined" ? process.env : ({} as NodeJS.ProcessEnv);

export const env = createEnv({
	server: {
		SERVER_URL: z.url().optional(),
		SUPABASE_URL: z.url(),
		SUPABASE_ANON_KEY: z.string().min(1),
		SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
		// Better Auth
		BETTER_AUTH_SECRET: z.string().min(32),
		BETTER_AUTH_URL: z.url(),
		DATABASE_URL: z.string().min(1),
		GOOGLE_CLIENT_ID: z.string().min(1).optional(),
		GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
		// Matching pipeline services (optional - graceful degradation)
		LASTFM_API_KEY: z.string().min(1).optional(),
		DEEPINFRA_API_KEY: z.string().min(1).optional(),
		HF_TOKEN: z.string().min(1).optional(),
		GENIUS_CLIENT_TOKEN: z.string().min(1).optional(),
		// ML provider selection (optional - defaults to deepinfra if key exists, else huggingface)
		ML_PROVIDER: z.enum(["deepinfra", "huggingface", "local"]).optional(),
		// LLM providers for content analysis (optional - analysis degrades gracefully
		// when absent; see src/lib/integrations/llm/config.ts). Google reads a fallback
		// chain matching Vercel AI SDK conventions.
		GEMINI_API_KEY: z.string().min(1).optional(),
		GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
		GOOGLE_API_KEY: z.string().min(1).optional(),
		// Vertex AI (default Google transport): bills the GCP project so analysis
		// draws Cloud credits. Auth via ADC — set GOOGLE_APPLICATION_CREDENTIALS_JSON
		// in container deploys, or `gcloud auth application-default login` locally.
		GOOGLE_VERTEX_PROJECT: z.string().min(1).optional(),
		GOOGLE_VERTEX_LOCATION: z.string().min(1).optional(),
		GOOGLE_APPLICATION_CREDENTIALS_JSON: z.string().min(1).optional(),
		ANTHROPIC_API_KEY: z.string().min(1).optional(),
		OPENAI_API_KEY: z.string().min(1).optional(),
		// Email (optional - waitlist confirmation emails skipped if not set)
		RESEND_API_KEY: z.string().min(1).optional(),
		// Billing integration
		BILLING_ENABLED: boolString,
		BILLING_SERVICE_URL: z.url().optional(),
		BILLING_SHARED_SECRET: z.string().min(1).optional(),
		QUARTERLY_PLAN_ENABLED: boolString,
	},

	clientPrefix: "VITE_",

	client: {
		VITE_PUBLIC_APP_ORIGIN: z.url().optional(),
		VITE_APP_TITLE: z.string().min(1).optional(),
		VITE_CHROME_EXTENSION_ID: z.string().min(1).optional(),
		VITE_PUBLIC_POSTHOG_PROJECT_TOKEN: z.string().min(1).optional(),
		VITE_PUBLIC_POSTHOG_HOST: z.string().min(1).optional(),
		// Sentry DSN is bundled at build time. Server-side DSN comes from the
		// Worker env binding (wrangler secret), not process.env.
		VITE_SENTRY_DSN: z.url().optional(),
		VITE_SENTRY_ENVIRONMENT: z.string().min(1).optional(),
		// Git SHA stamped at build; canonical release for Sentry + PostHog.
		VITE_APP_RELEASE: z.string().min(1).optional(),
	},

	/**
	 * Tell t3-env when we're on the server so it knows when to validate server vars.
	 * On client, server vars return a proxy that throws if accessed.
	 */
	isServer: typeof window === "undefined",

	/**
	 * Server vars from process.env (TanStack Start loads .env on server).
	 * Client vars from import.meta.env (Vite bundles VITE_* vars).
	 */
	runtimeEnv: {
		SERVER_URL: serverEnv.SERVER_URL,
		SUPABASE_URL: serverEnv.SUPABASE_URL,
		SUPABASE_ANON_KEY: serverEnv.SUPABASE_ANON_KEY,
		SUPABASE_SERVICE_ROLE_KEY: serverEnv.SUPABASE_SERVICE_ROLE_KEY,
		BETTER_AUTH_SECRET: serverEnv.BETTER_AUTH_SECRET,
		BETTER_AUTH_URL: serverEnv.BETTER_AUTH_URL,
		DATABASE_URL: serverEnv.DATABASE_URL,
		GOOGLE_CLIENT_ID: serverEnv.GOOGLE_CLIENT_ID,
		GOOGLE_CLIENT_SECRET: serverEnv.GOOGLE_CLIENT_SECRET,
		LASTFM_API_KEY: serverEnv.LASTFM_API_KEY,
		DEEPINFRA_API_KEY: serverEnv.DEEPINFRA_API_KEY,
		HF_TOKEN: serverEnv.HF_TOKEN,
		GENIUS_CLIENT_TOKEN: serverEnv.GENIUS_CLIENT_TOKEN,
		ML_PROVIDER: serverEnv.ML_PROVIDER,
		GEMINI_API_KEY: serverEnv.GEMINI_API_KEY,
		GOOGLE_GENERATIVE_AI_API_KEY: serverEnv.GOOGLE_GENERATIVE_AI_API_KEY,
		GOOGLE_API_KEY: serverEnv.GOOGLE_API_KEY,
		GOOGLE_VERTEX_PROJECT: serverEnv.GOOGLE_VERTEX_PROJECT,
		GOOGLE_VERTEX_LOCATION: serverEnv.GOOGLE_VERTEX_LOCATION,
		GOOGLE_APPLICATION_CREDENTIALS_JSON:
			serverEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON,
		ANTHROPIC_API_KEY: serverEnv.ANTHROPIC_API_KEY,
		OPENAI_API_KEY: serverEnv.OPENAI_API_KEY,
		RESEND_API_KEY: serverEnv.RESEND_API_KEY,
		BILLING_ENABLED: serverEnv.BILLING_ENABLED,
		BILLING_SERVICE_URL: serverEnv.BILLING_SERVICE_URL,
		BILLING_SHARED_SECRET: serverEnv.BILLING_SHARED_SECRET,
		QUARTERLY_PLAN_ENABLED: serverEnv.QUARTERLY_PLAN_ENABLED,
		VITE_PUBLIC_APP_ORIGIN: import.meta.env.VITE_PUBLIC_APP_ORIGIN,
		VITE_APP_TITLE: import.meta.env.VITE_APP_TITLE,
		VITE_CHROME_EXTENSION_ID: import.meta.env.VITE_CHROME_EXTENSION_ID,
		VITE_PUBLIC_POSTHOG_PROJECT_TOKEN: import.meta.env
			.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN,
		VITE_PUBLIC_POSTHOG_HOST: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
		VITE_SENTRY_DSN: import.meta.env.VITE_SENTRY_DSN,
		VITE_SENTRY_ENVIRONMENT: import.meta.env.VITE_SENTRY_ENVIRONMENT,
		VITE_APP_RELEASE: import.meta.env.VITE_APP_RELEASE,
	},

	emptyStringAsUndefined: true,
});
