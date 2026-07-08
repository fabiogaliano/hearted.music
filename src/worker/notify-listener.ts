/**
 * Postgres LISTEN/NOTIFY wake-up for worker loops.
 *
 * Turns enqueues into sub-second worker pickups instead of waiting out the
 * (deliberately relaxed) poll intervals. The poll loop stays as the
 * at-most-once-delivery safety net.
 *
 * Connection requirements (verified): LISTEN works over a direct connection or
 * the Supabase session-mode pooler (port 5432), never the transaction-mode
 * pooler (6543). postgres.js manages a single dedicated connection and
 * auto-reconnects; its `onlisten` callback fires on every (re)subscribe, which
 * we use to run a catch-up claim cycle for any notification missed while down.
 */

import postgres from "postgres";
import { env } from "@/env";
import { log } from "@/lib/observability/logger";
import { classifyDatabaseConnection } from "./db-backup";

export interface NotifyListener {
	stop: () => Promise<void>;
}

const CLOSE_TIMEOUT_SECONDS = 5;

function coalesce(fn: () => void, windowMs: number): () => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return () => {
		if (timer !== null) return;
		timer = setTimeout(() => {
			timer = null;
			fn();
		}, windowMs);
	};
}

/**
 * Starts listening for notifications on the given channels. `handlers` maps
 * channel names to wake functions. Wakes are coalesced to at most one per
 * windowMs (default 200ms) per channel.
 *
 * No-op (returns a stop that resolves immediately) when DATABASE_URL points at
 * the transaction-mode pooler, which cannot carry LISTEN — the poll loop then
 * covers pickup on its own.
 */
export function startNotifyListener(
	handlers: Record<string, () => void>,
	windowMs = 200,
): NotifyListener {
	let parsedUrl: URL | null = null;
	try {
		parsedUrl = new URL(env.DATABASE_URL);
	} catch {
		parsedUrl = null;
	}

	if (
		parsedUrl &&
		classifyDatabaseConnection(parsedUrl) === "transaction-pooler"
	) {
		log.warn("notify-listener-disabled", {
			reason:
				"DATABASE_URL is the transaction-mode pooler (6543), which cannot LISTEN; relying on poll fallback.",
		});
		return { stop: async () => {} };
	}

	const sql = postgres(env.DATABASE_URL, {
		prepare: false,
		max: 1,
		fetch_types: false,
		// A dedicated listener connection must stay open; do not idle it out.
		idle_timeout: 0,
		onnotice: () => {},
	});

	let stopped = false;
	const channels = Object.keys(handlers);
	const coalescedHandlers = Object.fromEntries(
		Object.entries(handlers).map(([ch, fn]) => [ch, coalesce(fn, windowMs)]),
	);

	for (const channel of channels) {
		void sql
			.listen(
				channel,
				() => coalescedHandlers[channel](),
				() => {
					// Fired on first subscribe and after each reconnect. Run a catch-up
					// cycle so notifications dropped while disconnected aren't stranded.
					log.info("notify-listener-connected", { channel });
					coalescedHandlers[channel]();
				},
			)
			.catch((error) => {
				if (stopped) return;
				log.error("notify-listen-failed", { channel, error: String(error) });
			});
	}

	log.info("notify-listener-start", { channels });

	return {
		stop: async () => {
			stopped = true;
			try {
				await sql.end({ timeout: CLOSE_TIMEOUT_SECONDS });
			} catch (error) {
				log.warn("notify-listener-stop-error", { error: String(error) });
			}
		},
	};
}
