/**
 * Postgres LISTEN/NOTIFY wake-up for the extension_sync worker loop.
 *
 * begin_extension_sync fires `pg_notify('job_created', ...)` the instant a sync
 * is enqueued; this listener turns that into a sub-second worker pickup instead
 * of waiting out the (deliberately relaxed) poll interval. The poll loop stays
 * as the at-most-once-delivery safety net.
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

const LISTEN_CHANNEL = "job_created";
const CLOSE_TIMEOUT_SECONDS = 5;

/**
 * Starts listening for job_created notifications. `onWake` is invoked on every
 * notification and on every (re)connection; it should be idempotent and cheap
 * (claims go through SKIP LOCKED, so a spurious wake just finds nothing).
 *
 * No-op (returns a stop that resolves immediately) when DATABASE_URL points at
 * the transaction-mode pooler, which cannot carry LISTEN — the poll loop then
 * covers pickup on its own.
 */
export function startJobCreatedListener(onWake: () => void): NotifyListener {
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
				"DATABASE_URL is the transaction-mode pooler (6543), which cannot LISTEN; relying on poll fallback. Use a direct connection or the session pooler (5432).",
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

	void sql
		.listen(
			LISTEN_CHANNEL,
			() => {
				// Payload is just {id, type}; any notification means "go claim". We
				// don't branch on type — extension_sync is the only producer, and the
				// claim RPC is a no-op when the queue is empty.
				onWake();
			},
			() => {
				// Fired on first subscribe and after each reconnect. Run a catch-up
				// cycle so notifications dropped while disconnected aren't stranded
				// (NOTIFY is at-most-once).
				log.info("notify-listener-connected", { channel: LISTEN_CHANNEL });
				onWake();
			},
		)
		.catch((error) => {
			if (stopped) return;
			log.error("notify-listen-failed", { error: String(error) });
		});

	log.info("notify-listener-start", { channel: LISTEN_CHANNEL });

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
