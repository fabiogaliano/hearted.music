import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { billingKeys } from "@/features/billing/query-keys";
import { dashboardKeys } from "@/features/dashboard/queries";
import { likedSongsKeys } from "@/features/liked-songs/queries";
import { matchDeckKeys } from "@/features/matching/deck-queries";
import type {
	AccountEventPayloadMap,
	ActiveJobsSnapshot,
	AnyAccountEventEnvelope,
} from "@/lib/account-events/contract";
import { getAccountEventsToken } from "@/lib/server/account-events.functions";

export type ConnectionState =
	| "connecting"
	| "connected"
	| "disconnected"
	| "error"
	| "forbidden";

const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 30000;

export const accountEventsConnectionKey = (accountId: string) =>
	["account-events-connection", accountId] as const;

function setActiveJobsSnapshot(
	queryClient: ReturnType<typeof useQueryClient>,
	accountId: string,
	snapshot: ActiveJobsSnapshot,
) {
	queryClient.setQueryData<ActiveJobsSnapshot>(
		["active-jobs", accountId],
		snapshot,
	);
}

function applyJobProgressChanged(
	previous: ActiveJobsSnapshot | undefined,
	update: AccountEventPayloadMap["job_progress_changed"],
): ActiveJobsSnapshot | undefined {
	if (!previous) return previous;

	if (update.kind === "enrichment") {
		return {
			...previous,
			enrichment: previous.enrichment
				? {
						...previous.enrichment,
						progress: update.progress,
					}
				: previous.enrichment,
		};
	}

	return {
		...previous,
		matchSnapshotRefresh: previous.matchSnapshotRefresh
			? {
					...previous.matchSnapshotRefresh,
					progress: update.progress,
				}
			: previous.matchSnapshotRefresh,
	};
}

function invalidateEnrichmentCompletionQueries(
	queryClient: ReturnType<typeof useQueryClient>,
	accountId: string,
) {
	queryClient.invalidateQueries({
		queryKey: dashboardKeys.pageData(accountId),
	});
	queryClient.invalidateQueries({
		queryKey: dashboardKeys.stats(accountId),
	});
	queryClient.invalidateQueries({
		queryKey: dashboardKeys.recentActivity(accountId),
	});
	queryClient.invalidateQueries({
		queryKey: likedSongsKeys.stats(accountId),
	});
	queryClient.invalidateQueries({ queryKey: likedSongsKeys.all });
}

export function useAccountEvents(accountId: string, enabled = true) {
	const queryClient = useQueryClient();
	const [connectionState, _setConnectionState] =
		useState<ConnectionState>("disconnected");

	const setConnectionState = useCallback(
		(state: ConnectionState) => {
			_setConnectionState(state);
			queryClient.setQueryData(accountEventsConnectionKey(accountId), state);
		},
		[accountId, queryClient],
	);

	const lastSeenPublishIdRef = useRef<number | undefined>(undefined);

	useEffect(() => {
		if (!enabled) {
			setConnectionState("disconnected");
			return;
		}

		let abortController: AbortController | null = null;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
		let backoffAttempt = 0;
		let isUnmounted = false;

		const clearTimers = () => {
			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
		};

		const disconnect = () => {
			if (abortController) {
				abortController.abort();
				abortController = null;
			}
			clearTimers();
		};

		const scheduleReconnect = (forceRemint = false) => {
			if (isUnmounted) return;
			disconnect();
			setConnectionState("error");

			if (forceRemint) {
				void connect(true);
				return;
			}

			const attempt = backoffAttempt++;
			const baseDelay = Math.min(
				BACKOFF_CAP_MS,
				BACKOFF_BASE_MS * 2 ** attempt,
			);
			const jitteredDelay = Math.random() * baseDelay;

			reconnectTimer = setTimeout(() => {
				void connect();
			}, jitteredDelay);
		};

		const processFrame = (frameStr: string) => {
			const lines = frameStr.split("\n");
			let eventType = "";
			let dataStr = "";
			let idStr: string | undefined;

			for (const line of lines) {
				if (line.startsWith(":")) continue; // comment
				const colonIdx = line.indexOf(":");
				if (colonIdx === -1) continue;
				const field = line.slice(0, colonIdx).trim();
				const value = line.slice(colonIdx + 1).trimStart();

				if (field === "event") eventType = value;
				else if (field === "data") dataStr += value;
				else if (field === "id") idStr = value;
			}

			if (!eventType || !dataStr) return;

			// Dedupe & cursor advance (durable frames only)
			if (idStr !== undefined) {
				const parsedId = parseInt(idStr, 10);
				if (!Number.isNaN(parsedId)) {
					if (
						lastSeenPublishIdRef.current !== undefined &&
						parsedId <= lastSeenPublishIdRef.current
					) {
						return; // Drop older or duplicate
					}
					lastSeenPublishIdRef.current = parsedId;
				}
			}

			let envelope: AnyAccountEventEnvelope;
			try {
				envelope = JSON.parse(dataStr);
			} catch {
				return; // Invalid JSON
			}

			switch (envelope.type) {
				case "active_jobs_snapshot":
					setActiveJobsSnapshot(queryClient, accountId, envelope.data);
					break;
				case "job_progress_changed":
					queryClient.setQueryData<ActiveJobsSnapshot | undefined>(
						["active-jobs", accountId],
						(old) => applyJobProgressChanged(old, envelope.data),
					);
					break;
				case "enrichment_completed":
				case "enrichment_stopped":
					invalidateEnrichmentCompletionQueries(queryClient, accountId);
					break;
				case "match_snapshot_published":
					queryClient.invalidateQueries({ queryKey: matchDeckKeys.deckRoot });
					queryClient.invalidateQueries({
						queryKey: ["active-jobs", accountId],
					});
					break;
				case "match_deck_appended":
					queryClient.invalidateQueries({
						queryKey: matchDeckKeys.deck(accountId, envelope.data.orientation),
					});
					break;
				case "billing_state_changed":
					queryClient.invalidateQueries({ queryKey: billingKeys.state });
					break;
				case "token_expiring":
					scheduleReconnect(true);
					break;
				case "error":
					scheduleReconnect();
					break;
				default:
					break;
			}
		};

		const connect = async (_forceRemint = false) => {
			if (isUnmounted) return;
			disconnect();

			abortController = new AbortController();
			const currentSignal = abortController.signal;

			setConnectionState("connecting");

			try {
				const tokenRes = await getAccountEventsToken({ data: undefined });
				const token = tokenRes.token;

				if (currentSignal.aborted) return;

				// 2. Fetch SSE
				const headers: Record<string, string> = {
					Accept: "text/event-stream",
					Authorization: `Bearer ${token}`,
				};
				if (lastSeenPublishIdRef.current !== undefined) {
					headers["Last-Event-ID"] = lastSeenPublishIdRef.current.toString();
				}

				const streamUrl = import.meta.env.VITE_ACCOUNT_EVENTS_GATEWAY_URL
					? `${import.meta.env.VITE_ACCOUNT_EVENTS_GATEWAY_URL}/account-events/stream`
					: "/account-events/stream";

				const response = await fetch(streamUrl, {
					headers,
					signal: currentSignal,
				});

				if (currentSignal.aborted) return;

				// Handle HTTP statuses
				if (response.status === 401) {
					scheduleReconnect(true); // force remint
					return;
				}
				if (response.status === 403) {
					setConnectionState("forbidden");
					return; // Stop and surface re-auth
				}
				if (
					response.status === 429 ||
					response.status === 503 ||
					!response.ok
				) {
					scheduleReconnect();
					return;
				}

				setConnectionState("connected");
				backoffAttempt = 0; // reset on stable connection

				// 3. Parse stream
				if (!response.body) {
					scheduleReconnect();
					return;
				}

				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					if (currentSignal.aborted) return;

					buffer += decoder.decode(value, { stream: true });

					let splitIndex = buffer.indexOf("\n\n");
					while (splitIndex >= 0) {
						const frameStr = buffer.slice(0, splitIndex);
						buffer = buffer.slice(splitIndex + 2);
						processFrame(frameStr);
						splitIndex = buffer.indexOf("\n\n");
					}
				}

				// Stream closed normally
				scheduleReconnect();
			} catch (err: unknown) {
				if (
					err instanceof Error &&
					(err.name === "AbortError" || currentSignal.aborted)
				)
					return;
				scheduleReconnect();
			}
		};

		void connect();

		return () => {
			isUnmounted = true;
			disconnect();
		};
	}, [accountId, enabled, queryClient, setConnectionState]);

	return {
		connectionState,
	};
}
