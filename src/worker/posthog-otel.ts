import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { PostHogSpanProcessor } from "@posthog/ai/otel";
import { resolvePostHogHosts } from "@/lib/observability/posthog-hosts";

// The Bun worker is a standalone Coolify container with no Vite build step, so a
// `VITE_`-prefixed name here is a misleading frontend artifact that's easy to omit
// from container env — and omitting it silently disables LLM cost tracking (the
// `!apiKey` early-return below). Prefer the plain worker-style names, falling back
// to the legacy `VITE_` names so an already-configured container doesn't regress.
const apiKey =
	process.env.POSTHOG_PROJECT_TOKEN ??
	process.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN;
const configuredHost =
	process.env.POSTHOG_HOST ?? process.env.VITE_PUBLIC_POSTHOG_HOST;

let sdk: NodeSDK | null = null;

export function initPostHogOtel() {
	// Production-only: avoid shipping local LLM spans to prod analytics.
	if (process.env.NODE_ENV !== "production") return;
	if (!apiKey) return;

	const resolvedHosts = resolvePostHogHosts(configuredHost, {
		strict: process.env.NODE_ENV === "production",
	});
	if (resolvedHosts.kind === "invalid") {
		throw new Error(resolvedHosts.reason);
	}

	sdk = new NodeSDK({
		resource: resourceFromAttributes({ "service.name": "hearted-worker" }),
		spanProcessors: [
			new PostHogSpanProcessor({ apiKey, host: resolvedHosts.value.apiHost }),
		],
	});
	sdk.start();
}

export function shutdownPostHogOtel(): Promise<void> {
	return sdk?.shutdown() ?? Promise.resolve();
}
