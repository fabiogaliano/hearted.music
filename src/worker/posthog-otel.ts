import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { PostHogSpanProcessor } from "@posthog/ai/otel";

const DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com";
const apiKey = process.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN;
const configuredHost = process.env.VITE_PUBLIC_POSTHOG_HOST;

let sdk: NodeSDK | null = null;

export function initPostHogOtel() {
	if (!apiKey) return;

	let host = DEFAULT_POSTHOG_HOST;
	if (configuredHost) {
		const configuredOrigin = new URL(configuredHost).origin;
		if (configuredOrigin !== DEFAULT_POSTHOG_HOST) {
			throw new Error(
				"hearted is configured for PostHog EU only. Use https://eu.i.posthog.com.",
			);
		}
		host = configuredOrigin;
	}

	sdk = new NodeSDK({
		resource: resourceFromAttributes({ "service.name": "hearted-worker" }),
		spanProcessors: [new PostHogSpanProcessor({ apiKey, host })],
	});
	sdk.start();
}

export function shutdownPostHogOtel(): Promise<void> {
	return sdk?.shutdown() ?? Promise.resolve();
}
