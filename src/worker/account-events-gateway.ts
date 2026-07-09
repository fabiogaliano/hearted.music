import postgres from "postgres";
import { env } from "@/env";
import {
	type AccountEventEnvelope,
	type AllFrameType,
	CURSOR_HEADER,
	HEARTBEAT_INTERVAL_MS,
	NOTIFY_CHANNEL_WAKE,
} from "@/lib/account-events/contract";
import { verifyEventToken } from "@/lib/account-events/token";
import { log } from "@/lib/observability/logger";
import { buildActiveJobsSnapshot } from "@/lib/server/jobs.functions";

type StreamController = ReadableStreamDefaultController<string>;

interface AccountEventClient {
	controller: StreamController;
	cursor: number;
	lastActivity: number;
	accountId: string;
	close: () => void;
}

interface ReplayRow {
	publish_id: number;
	type: string;
	payload: unknown;
	created_at: string;
}

interface StreamEnvelope {
	type: string;
	v: 1;
	ts: number;
	publishId?: number;
	data: unknown;
}

// Connected clients grouped by accountId
const clients = new Map<string, Set<AccountEventClient>>();

let listenSql: postgres.Sql<Record<string, never>> | null = null;
let querySql: postgres.Sql<Record<string, never>> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

function getOrCreateAccountClients(accountId: string) {
	const existingClients = clients.get(accountId);
	if (existingClients) {
		return existingClients;
	}

	const nextClients = new Set<AccountEventClient>();
	clients.set(accountId, nextClients);
	return nextClients;
}

function sendEnvelope(client: AccountEventClient, envelope: StreamEnvelope) {
	try {
		const isDurable = "publishId" in envelope && envelope.publishId != null;
		let frame = "";
		if (isDurable) {
			frame += `id: ${envelope.publishId}\n`;
		}
		frame += `event: ${envelope.type}\n`;
		frame += `data: ${JSON.stringify(envelope)}\n\n`;

		if (
			client.controller.desiredSize !== null &&
			client.controller.desiredSize <= 0
		) {
			log.warn("gateway-buffer-overflow", { cursor: client.cursor });
			client.close();
			return false;
		}
		client.controller.enqueue(frame);
		return true;
	} catch (error) {
		log.error("gateway-send-error", { error: String(error) });
		return false;
	}
}

function sendEvent<T extends AllFrameType>(
	client: AccountEventClient,
	envelope: AccountEventEnvelope<T>,
) {
	return sendEnvelope(client, envelope);
}

function sendReplayRow(client: AccountEventClient, row: ReplayRow) {
	return sendEnvelope(client, {
		type: row.type,
		v: 1,
		ts: Number(row.created_at),
		publishId: row.publish_id,
		data: row.payload,
	});
}

async function initializeClientStream(
	controller: StreamController,
	accountClients: Set<AccountEventClient>,
	accountId: string,
	requestSignal: AbortSignal,
	cursor: number,
	expiresAtSeconds: number,
) {
	let closed = false;
	let expTimer: ReturnType<typeof setTimeout> | null = null;

	const cleanup = () => {
		if (closed) return;
		closed = true;
		if (expTimer) clearTimeout(expTimer);
		accountClients.delete(clientState);
		if (accountClients.size === 0) {
			clients.delete(accountId);
		}
		try {
			controller.close();
		} catch {}
	};

	const clientState: AccountEventClient = {
		controller,
		cursor,
		lastActivity: Date.now(),
		accountId,
		close: cleanup,
	};
	accountClients.add(clientState);

	requestSignal.addEventListener("abort", cleanup);

	const timeUntilExp = expiresAtSeconds * 1000 - Date.now();
	expTimer = setTimeout(() => {
		try {
			sendEvent(clientState, {
				type: "token_expiring",
				v: 1,
				ts: Date.now(),
				data: { reason: "token_expired" },
			});
		} catch {
			// ignore
		}
		cleanup();
	}, timeUntilExp);

	await fetchAndSendReplay(accountId, clientState);
}

async function fetchAndSendReplay(
	accountId: string,
	client: AccountEventClient,
) {
	if (!querySql) return;

	try {
		const rows = await querySql<ReplayRow[]>`
			SELECT publish_id, type, payload, extract(epoch from created_at) * 1000 as created_at
			FROM account_event
			WHERE account_id = ${accountId} AND publish_id > ${client.cursor}
			ORDER BY publish_id ASC
		`;

		for (const row of rows) {
			const success = sendReplayRow(client, row);
			if (!success) return;
			client.cursor = row.publish_id;
		}

		// Always send snapshot after connect and replay
		const snapshot = await buildActiveJobsSnapshot(accountId);
		sendEvent(client, {
			type: "active_jobs_snapshot",
			v: 1,
			ts: Date.now(),
			data: snapshot,
		});
	} catch (error) {
		log.error("gateway-replay-error", { accountId, error: String(error) });
	}
}

async function catchUpAccount(accountId: string) {
	const accountClients = clients.get(accountId);
	if (!accountClients || accountClients.size === 0) return;

	// In a real system, we could query once per account and distribute,
	// but since cursors might differ slightly, querying per cursor or just once
	// from the minimum cursor is fine.
	// For simplicity, we fetch per client here since the volume is low.
	for (const client of accountClients) {
		await fetchAndSendReplay(accountId, client);
	}
}

function handleWake() {
	// payload could be tiny min/max hint, but we just want to wake everyone
	// connected who might have new events.
	// We can't know which account just had an event from the empty payload,
	// so we'd have to check all. But wait, `account_event_wake` doesn't include accountId.
	// The contract says: "LISTEN account_event_wake -> per-account catch-up query for connected local clients".
	// Since we don't know the accountId, we must check for all active clients.
	for (const accountId of clients.keys()) {
		void catchUpAccount(accountId);
	}
}

let server: ReturnType<typeof import("bun").serve> | undefined;

let draining = false;

export function setAccountEventsGatewayDraining(isDraining: boolean) {
	draining = isDraining;
}

export function startAccountEventsGateway() {
	querySql = postgres(env.DATABASE_URL, {
		max: 10,
	});

	listenSql = postgres(env.DATABASE_URL, {
		max: 1,
		idle_timeout: 0,
	});

	listenSql
		.listen(NOTIFY_CHANNEL_WAKE, handleWake, () => {
			for (const accountId of clients.keys()) {
				void catchUpAccount(accountId);
			}
		})
		.catch((error) => {
			log.error("gateway-listen-error", { error: String(error) });
		});

	// Also listen for revoke channel
	listenSql
		.listen("account_event_revoke", (payload) => {
			// Payload is accountId
			const accountId = payload;
			const accountClients = clients.get(accountId);
			if (accountClients) {
				for (const client of accountClients) {
					try {
						sendEvent(client, {
							type: "error",
							v: 1,
							ts: Date.now(),
							data: { code: "revoked" },
						});
						client.close();
					} catch {
						// Ignore
					}
				}
				clients.delete(accountId);
			}
		})
		.catch(() => {});

	// Heartbeat loop
	heartbeatInterval = setInterval(() => {
		for (const accountClients of clients.values()) {
			for (const client of accountClients) {
				try {
					if (
						client.controller.desiredSize !== null &&
						client.controller.desiredSize <= 0
					) {
						client.close();
					} else {
						client.controller.enqueue(": ping\n\n");
					}
				} catch {
					// Ignore, client might be closed
				}
			}
		}
	}, HEARTBEAT_INTERVAL_MS);

	const port = Number(process.env.WORKER_ACCOUNT_EVENTS_GATEWAY_PORT ?? 3003);

	server = Bun.serve({
		port,
		hostname: "0.0.0.0",
		async fetch(req, bunServer) {
			const url = new URL(req.url);

			if (url.pathname !== "/account-events/stream") {
				return new Response("Not Found", { status: 404 });
			}

			if (req.method !== "GET") {
				return new Response("Method Not Allowed", { status: 405 });
			}

			if (draining) {
				return new Response("Service Unavailable", { status: 503 });
			}

			const authHeader = req.headers.get("Authorization");
			if (!authHeader?.startsWith("Bearer ")) {
				return new Response("Unauthorized", { status: 401 });
			}

			const token = authHeader.slice("Bearer ".length);
			const claims = await verifyEventToken(token);

			if (!claims) {
				return new Response("Unauthorized", { status: 401 });
			}

			// §4.3 Invariant 2: connect-time ver check
			if (claims.ver !== 1) {
				return new Response("Forbidden", { status: 403 });
			}

			const cursorStr =
				req.headers.get(CURSOR_HEADER) ?? req.headers.get("last-event-id");
			const cursor =
				cursorStr && cursorStr !== "?" ? parseInt(cursorStr, 10) : 0;

			// Cap concurrent streams per account
			const accountClients = getOrCreateAccountClients(claims.sub);

			if (accountClients.size >= 5) {
				// Too many concurrent streams
				return new Response("Too Many Requests", { status: 429 });
			}

			// Disable Bun's idle timeout for this connection
			bunServer.timeout(req, 0);

			const responseHeaders = {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				"X-Accel-Buffering": "no",
			};

			return new Response(
				new ReadableStream({
					start: async (controller) => {
						await initializeClientStream(
							controller,
							accountClients,
							claims.sub,
							req.signal,
							cursor,
							claims.exp,
						);
					},
					cancel() {
						// Cleaned up via abort listener
					},
				}),
				{ headers: responseHeaders },
			);
		},
	});
	return server;
}

export async function stopAccountEventsGateway() {
	if (heartbeatInterval) {
		clearInterval(heartbeatInterval);
	}
	if (listenSql) {
		await listenSql.end();
	}
	if (querySql) {
		await querySql.end();
	}
	for (const accountClients of clients.values()) {
		// iterate over a copy since close() mutates the set
		for (const client of Array.from(accountClients)) {
			try {
				client.close();
			} catch {}
		}
	}
	clients.clear();
	if (server) {
		server.stop(true);
	}
}
