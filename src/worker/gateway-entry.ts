import * as Sentry from "@sentry/bun";
import { log } from "@/lib/observability/logger";
import {
	setAccountEventsGatewayDraining,
	startAccountEventsGateway,
	stopAccountEventsGateway,
} from "./account-events-gateway";
import { setWorkerFatalObserver } from "./fatal-handlers";

setWorkerFatalObserver((error, phase) => {
	log.error(phase, { error: String(error) });
	// We don't have a specific unhealthy state for the gateway, but we'll let it exit
});

let draining = false;

async function main() {
	log.info("gateway-starting");

	const shutdown = async (signal: string) => {
		if (draining) return;
		draining = true;
		log.info("gateway-shutdown-initiated", { signal });

		setAccountEventsGatewayDraining(true);
		await stopAccountEventsGateway();

		// Flush queued events
		await Sentry.flush(2000);
		log.info("gateway-stopped");
		process.exit(0);
	};

	process.on("SIGTERM", () => shutdown("SIGTERM"));
	process.on("SIGINT", () => shutdown("SIGINT"));

	startAccountEventsGateway();
}

main().catch((err) => {
	log.error("gateway-fatal", { error: String(err) });
	Sentry.captureException(err, { tags: { phase: "main" } });
	Sentry.flush(2000).finally(() => process.exit(1));
});
