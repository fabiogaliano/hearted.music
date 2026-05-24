import { usePostHog } from "@posthog/react";
import type { PostHogInterface } from "posthog-js";

type AnalyticsClient = Pick<PostHogInterface, "capture" | "identify" | "reset">;

const noopAnalyticsClient: AnalyticsClient = {
	capture() {},
	identify() {},
	reset() {},
};

function isAnalyticsClient(value: unknown): value is AnalyticsClient {
	return (
		typeof value === "object" &&
		value !== null &&
		"capture" in value &&
		typeof value.capture === "function" &&
		"identify" in value &&
		typeof value.identify === "function" &&
		"reset" in value &&
		typeof value.reset === "function"
	);
}

export function useAnalytics(): AnalyticsClient {
	const posthog = usePostHog();
	return isAnalyticsClient(posthog) ? posthog : noopAnalyticsClient;
}
