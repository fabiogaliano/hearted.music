import type { AnyRouter } from "@tanstack/router-core";
import { createClientOnlyFn } from "@tanstack/react-start";

const loadSentryClient = createClientOnlyFn(() => import("./sentry.client"));

type CaptureContext = {
	route?: string;
	[key: string]: unknown;
};

export function initSentry(router: AnyRouter): void {
	void loadSentryClient().then((module) => {
		module?.initSentry(router);
	});
}

export function captureRouteError(
	error: unknown,
	context: CaptureContext = {},
): void {
	void loadSentryClient().then((module) => {
		module?.captureRouteError(error, context);
	});
}
