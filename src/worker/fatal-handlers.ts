import * as Sentry from "@sentry/bun";

let registered = false;
let crashing = false;
let fatalObserver: ((error: unknown, phase: FatalPhase) => void) | null = null;

type FatalPhase = "uncaught-exception" | "unhandled-rejection";

function handleFatal(error: unknown, phase: FatalPhase): void {
	if (crashing) return;
	crashing = true;
	fatalObserver?.(error, phase);
	if (!fatalObserver) {
		console.error(`[worker] ${phase}`, error);
	}
	Sentry.captureException(error, { tags: { phase } });
	Sentry.flush(2000).finally(() => process.exit(1));
}

export function setWorkerFatalObserver(
	observer: (error: unknown, phase: FatalPhase) => void,
): void {
	fatalObserver = observer;
}

export function registerWorkerFatalHandlers(): void {
	if (registered) return;
	registered = true;

	process.on("uncaughtException", (error) =>
		handleFatal(error, "uncaught-exception"),
	);
	process.on("unhandledRejection", (reason) =>
		handleFatal(reason, "unhandled-rejection"),
	);
}
