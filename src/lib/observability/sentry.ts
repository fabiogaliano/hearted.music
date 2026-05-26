import { createClientOnlyFn } from "@tanstack/react-start";
import type { AnyRouter } from "@tanstack/router-core";

const loadSentryClient = createClientOnlyFn(() => import("./sentry.client"));

type SentryClientModule = typeof import("./sentry.client");

type CaptureContext = {
	route?: string;
	[key: string]: unknown;
};

export function initSentry(router: AnyRouter): void {
	void loadSentryClient().then((module: SentryClientModule | undefined) => {
		module?.initSentry(router);
	});
}

export function captureRouteError(
	error: unknown,
	context: CaptureContext = {},
): void {
	void loadSentryClient().then((module: SentryClientModule | undefined) => {
		module?.captureRouteError(error, context);
	});
}

export function enableSentryReplay(): void {
	void loadSentryClient().then((module: SentryClientModule | undefined) => {
		module?.enableSentryReplay();
	});
}

export function disableSentryReplay(): void {
	void loadSentryClient().then((module: SentryClientModule | undefined) => {
		module?.disableSentryReplay();
	});
}
