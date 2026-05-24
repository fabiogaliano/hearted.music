import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { PostHogSpanProcessor } from "@posthog/ai/otel";
import { resolvePostHogHosts } from "@/lib/observability/posthog-hosts";

const apiKey = process.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN;
const configuredHost = process.env.VITE_PUBLIC_POSTHOG_HOST;

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
