import postgres from "postgres";
import { env } from "@/env";
import {
	type AccountEventEnvelope,
	CURSOR_HEADER,
	HEARTBEAT_INTERVAL_MS,
	NOTIFY_CHANNEL_WAKE,
} from "@/lib/account-events/contract";
import { verifyEventToken } from "@/lib/account-events/token";
import { log } from "@/lib/observability/logger";
import { buildActiveJobsSnapshot } from "@/lib/server/jobs.functions";

// Connected clients grouped by accountId
const clients = new Map<
	string,
	Set<{
		controller: any;
		cursor: number;
		lastActivity: number;
	}>
>();

let listenSql: postgres.Sql<Record<string, never>> | null = null;
let querySql: postgres.Sql<Record<string, never>> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

function sendEvent(
	client: { controller: any; cursor: number },
	envelope: AccountEventEnvelope | Omit<AccountEventEnvelope, "publishId">,
) {
	try {
		const isDurable = "publishId" in envelope && envelope.publishId != null;
		let frame = "";
		if (isDurable) {
			frame += `id: ${envelope.publishId}\n`;
		}
		frame += `event: ${envelope.type}\n`;
		frame += `data: ${JSON.stringify(envelope)}\n\n`;

		if (typeof client.controller.write === "function") {
			const written = client.controller.write(frame);
			if (written === 0) {
				log.warn("gateway-buffer-overflow", { cursor: client.cursor });
				client.controller.close();
				return false;
			}
			client.controller.flush();
		} else {
			if (
				client.controller.desiredSize !== null &&
				client.controller.desiredSize <= 0
			) {
				log.warn("gateway-buffer-overflow", { cursor: client.cursor });
				client.controller.close();
				return false;
			}
			client.controller.enqueue(frame);
		}
		return true;
	} catch (error) {
		log.error("gateway-send-error", { error: String(error) });
		return false;
	}
}

async function fetchAndSendReplay(
	accountId: string,
	client: { controller: any; cursor: number },
) {
	if (!querySql) return;

	try {
		const rows = await querySql<
			{ publish_id: number; type: string; payload: any; created_at: string }[]
		>`
			SELECT publish_id, type, payload, extract(epoch from created_at) * 1000 as created_at
			FROM account_event
			WHERE account_id = ${accountId} AND publish_id > ${client.cursor}
			ORDER BY publish_id ASC
		`;

		for (const row of rows) {
			const success = sendEvent(client, {
				type: row.type as any,
				v: 1,
				ts: Number(row.created_at),
				publishId: row.publish_id,
				data: row.payload,
			});
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
						} as any);
						client.controller.close();
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
					if (typeof client.controller.write === "function") {
						const written = client.controller.write(": ping\n\n");
						if (written === 0) {
							client.controller.close();
						} else {
							client.controller.flush();
						}
					} else {
						if (
							client.controller.desiredSize !== null &&
							client.controller.desiredSize <= 0
						) {
							client.controller.close();
						} else {
							client.controller.enqueue(": ping\n\n");
						}
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
			let accountClients = clients.get(claims.sub);
			if (!accountClients) {
				accountClients = new Set();
				clients.set(claims.sub, accountClients);
			}

			if (accountClients.size >= 5) {
				// Too many concurrent streams
				return new Response("Too Many Requests", { status: 429 });
			}

			// Disable Bun's idle timeout for this connection
			bunServer.timeout(req, 0);

			const isBun = !!(process.versions && process.versions.bun);

			return new Response(
				new ReadableStream({
					type: isBun ? "direct" : undefined,
					start: async (controller: any) => {
						const clientState = {
							controller,
							cursor,
							lastActivity: Date.now(),
						};
						accountClients!.add(clientState);

						req.signal.addEventListener("abort", () => {
							accountClients!.delete(clientState);
							if (accountClients!.size === 0) {
								clients.delete(claims.sub);
							}
						});

						// Exp timer
						const timeUntilExp = claims.exp * 1000 - Date.now();
						const expTimer = setTimeout(() => {
							try {
								sendEvent(clientState, {
									type: "token_expiring",
									v: 1,
									ts: Date.now(),
									data: { reason: "token_expired" },
								});
								controller.close();
							} catch {
								// ignore
							}
						}, timeUntilExp);

						req.signal.addEventListener("abort", () => {
							clearTimeout(expTimer);
						});

						// Initial replay + snapshot
						await fetchAndSendReplay(claims.sub, clientState);
					},
					cancel() {
						// Cleaned up via abort listener
					},
				}),
				{
					headers: {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache",
						"X-Accel-Buffering": "no",
					},
				},
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
		for (const client of accountClients) {
			try {
				client.controller.close();
			} catch {}
		}
	}
	clients.clear();
	if (server) {
		server.stop(true);
	}
}
