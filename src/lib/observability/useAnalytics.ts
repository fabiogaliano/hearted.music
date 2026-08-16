import { usePostHog } from "@posthog/react";
import type { PostHogInterface } from "posthog-js";
import {
	type EmptyProperties,
	EVENT_SCHEMA_VERSION,
	type ProductEventMap,
	type ProductEventName,
} from "./product-events";

type AnalyticsCaptureArgs<E extends ProductEventName> =
	ProductEventMap[E] extends EmptyProperties
		? [
				event: E,
				properties?: ProductEventMap[E],
				options?: Parameters<PostHogInterface["capture"]>[2],
			]
		: [
				event: E,
				properties: ProductEventMap[E],
				options?: Parameters<PostHogInterface["capture"]>[2],
			];

export interface AnalyticsClient {
	capture<E extends ProductEventName>(...args: AnalyticsCaptureArgs<E>): void;
	identify: PostHogInterface["identify"];
	reset: PostHogInterface["reset"];
}

const noopAnalyticsClient: AnalyticsClient = {
	capture() {},
	identify() {},
	reset() {},
};

function isAnalyticsClient(
	value: unknown,
): value is Pick<PostHogInterface, "capture" | "identify" | "reset"> {
	return (
		typeof value === "object" &&
		value !== null &&
		"capture" in value &&
		typeof (value as { capture?: unknown }).capture === "function" &&
		"identify" in value &&
		typeof (value as { identify?: unknown }).identify === "function" &&
		"reset" in value &&
		typeof (value as { reset?: unknown }).reset === "function"
	);
}

export function useAnalytics(): AnalyticsClient {
	const posthog = usePostHog();
	if (!isAnalyticsClient(posthog)) return noopAnalyticsClient;

	return {
		capture<E extends ProductEventName>(...args: AnalyticsCaptureArgs<E>) {
			const [event, properties, options] = args;
			posthog.capture(
				event,
				{ schema_version: EVENT_SCHEMA_VERSION, ...(properties ?? {}) },
				options,
			);
		},
		identify: posthog.identify.bind(posthog),
		reset: posthog.reset.bind(posthog),
	};
}
