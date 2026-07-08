import postgres from "postgres";
import { env } from "@/env";
import {
	NOTIFY_CHANNEL_INSERTED,
	NOTIFY_CHANNEL_WAKE,
} from "@/lib/account-events/contract";
import { log } from "@/lib/observability/logger";
import { classifyDatabaseConnection } from "./db-backup";

let shouldPoll = true;
let listenSql: postgres.Sql<Record<string, never>> | null = null;
let txSql: postgres.Sql<Record<string, never>> | null = null;
let wakeTimeout: ReturnType<typeof setTimeout> | null = null;
let isPublishing = false;
let needsAnotherPublish = false;

// Debounce window (e.g. 100ms) for coalesce NOTIFY wakes.
const DEBOUNCE_MS = 100;
const FALLBACK_POLL_MS = 1000;

export function stopAccountEventPublisher() {
	shouldPoll = false;
	if (wakeTimeout) {
		clearTimeout(wakeTimeout);
		wakeTimeout = null;
	}
}

/**
 * Attempts to publish unassigned events.
 */
export async function publishAccountEvents(
	sql: postgres.Sql<Record<string, never>>,
) {
	if (isPublishing) {
		needsAnotherPublish = true;
		return;
	}
	isPublishing = true;
	needsAnotherPublish = false;

	try {
		await sql.begin(async (tx) => {
			const [{ locked }] = await tx<{ locked: boolean }[]>`
				SELECT pg_try_advisory_xact_lock(hashtext('account_event_publisher')) as locked
			`;

			if (!locked) {
				return;
			}

			// Claim unpublished events and update them
			const rows = await tx<{ id: number; publish_id: number }[]>`
				WITH claimed AS (
					SELECT id FROM account_event
					WHERE publish_id IS NULL
					ORDER BY id ASC
					FOR UPDATE SKIP LOCKED
				),
				assigned AS (
					SELECT id, nextval('account_event_publish_seq') as seq
					FROM claimed
					ORDER BY id ASC
				)
				UPDATE account_event
				SET 
					publish_id = assigned.seq,
					published_at = clock_timestamp()
				FROM assigned
				WHERE account_event.id = assigned.id
				RETURNING account_event.id, account_event.publish_id
			`;

			if (rows.length > 0) {
				const minPublishId = rows[0].publish_id;
				const maxPublishId = rows[rows.length - 1].publish_id;

				log.info("account-events-published", {
					count: rows.length,
					minPublishId,
					maxPublishId,
				});

				// Coalesce NOTIFY
				// Payload is empty or hint as per spec: "payload empty or a tiny {minPublishId,maxPublishId} hint"
				// Let's just send the hint.
				const payload = JSON.stringify({ minPublishId, maxPublishId });
				await tx`SELECT pg_notify(${NOTIFY_CHANNEL_WAKE}, ${payload})`;
			}
		});
	} catch (error) {
		log.error("account-events-publish-error", { error: String(error) });
	} finally {
		isPublishing = false;
		if (needsAnotherPublish && shouldPoll) {
			schedulePublish(sql);
		}
	}
}

function schedulePublish(sql: postgres.Sql<Record<string, never>>) {
	if (wakeTimeout) return;
	wakeTimeout = setTimeout(() => {
		wakeTimeout = null;
		if (shouldPoll) {
			void publishAccountEvents(sql);
		}
	}, DEBOUNCE_MS);
}

export async function startAccountEventPublisher() {
	shouldPoll = true;

	const parsedUrl = new URL(env.DATABASE_URL);
	if (classifyDatabaseConnection(parsedUrl) === "transaction-pooler") {
		log.warn("account-events-publisher-disabled", {
			reason:
				"DATABASE_URL is the transaction-mode pooler (6543), which cannot LISTEN or hold advisory xact locks safely.",
		});
		return;
	}

	// Connection for the publish transaction
	txSql = postgres(env.DATABASE_URL, {
		prepare: false,
		max: 1, // Single connection for the publisher txn lock
		fetch_types: false,
	});

	// Connection for listening
	listenSql = postgres(env.DATABASE_URL, {
		prepare: false,
		max: 1,
		fetch_types: false,
		idle_timeout: 0,
		onnotice: () => {},
	});

	let fallbackInterval: ReturnType<typeof setInterval> | null = null;

	try {
		await listenSql.listen(
			NOTIFY_CHANNEL_INSERTED,
			() => {
				if (txSql) schedulePublish(txSql);
			},
			() => {
				if (txSql) schedulePublish(txSql);
			},
		);

		log.info("account-events-publisher-started");

		fallbackInterval = setInterval(() => {
			if (shouldPoll && txSql) {
				schedulePublish(txSql);
			}
		}, FALLBACK_POLL_MS);

		while (shouldPoll) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	} catch (error) {
		log.error("account-events-publisher-failed", { error: String(error) });
	} finally {
		if (fallbackInterval) clearInterval(fallbackInterval);
		if (listenSql) await listenSql.end();
		if (txSql) await txSql.end();
	}
}
