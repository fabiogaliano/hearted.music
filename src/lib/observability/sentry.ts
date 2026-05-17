import * as Sentry from "@sentry/react";

export const RUNTIME_TAG = "web" as const;

type CaptureContext = {
	route?: string;
	[key: string]: unknown;
};

export function captureRouteError(
	error: unknown,
	context: CaptureContext = {},
): void {
	Sentry.captureException(error, {
		tags: {
			runtime: RUNTIME_TAG,
			...(context.route ? { route: context.route } : {}),
		},
		contexts: { route: context },
	});
}
