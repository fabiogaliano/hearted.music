import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type AccountEventPayloadMap,
	type ActiveJobsSnapshot,
	type AnyAccountEventEnvelope,
	CURSOR_RESPONSE_HEADER,
} from "@/lib/account-events/contract";
import {
	connectionStateOf,
	initialReconnectState,
	type ReconnectEvent,
	reconnectPolicy,
} from "@/lib/account-events/reconnect-policy";
import {
	activeJobsKeys,
	dashboardKeys,
	invalidateEntitlementQueries,
	invalidateLibrarySyncQueries,
	likedSongsKeys,
	matchDeckKeys,
} from "@/lib/query-keys";
import { getAccountEventsToken } from "@/lib/server/account-events.functions";

export type ConnectionState =
	| "connecting"
	| "connected"
	| "disconnected"
	| "error"
	| "forbidden";

function parseRetryAfterMs(value: string | null): number | undefined {
	if (!value) return undefined;

	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return seconds * 1000;
	}

	const dateMs = Date.parse(value);
	if (Number.isNaN(dateMs)) return undefined;

	return Math.max(0, dateMs - Date.now());
}

export const accountEventsConnectionKey = (accountId: string) =>
	["account-events-connection", accountId] as const;

/**
 * The stream's connection state, as useAccountEvents publishes it to the rest
 * of the app. Every reader must share these options: whichever mounts first
 * seeds the cache entry with its initialData.
 */
export function accountEventsConnectionQueryOptions(accountId: string) {
	return queryOptions<ConnectionState>({
		queryKey: accountEventsConnectionKey(accountId),
		queryFn: () => "disconnected",
		initialData: "disconnected",
		staleTime: Number.POSITIVE_INFINITY,
	});
}

function setActiveJobsSnapshot(
	queryClient: ReturnType<typeof useQueryClient>,
	accountId: string,
	snapshot: ActiveJobsSnapshot,
) {
	queryClient.setQueryData<ActiveJobsSnapshot>(
		activeJobsKeys.byAccount(accountId),
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

		const gatewayUrl = import.meta.env.VITE_ACCOUNT_EVENTS_GATEWAY_URL;
		// A production build without the gateway can never connect; minting
		// tokens for it would only add app-server load.
		if (!gatewayUrl && import.meta.env.PROD) {
			setConnectionState("error");
			return;
		}
		const streamUrl = gatewayUrl
			? `${gatewayUrl}/account-events/stream`
			: "/account-events/stream";

		let state = initialReconnectState;
		// One controller per mint/open attempt; aborting it discards whatever
		// that attempt would still report.
		let attempt: AbortController | null = null;
		let retryTimer: ReturnType<typeof setTimeout> | null = null;

		const stopAttempt = () => {
			attempt?.abort();
			attempt = null;
		};
		const clearRetryTimer = () => {
			if (retryTimer) {
				clearTimeout(retryTimer);
				retryTimer = null;
			}
		};

		const dispatch = (event: ReconnectEvent) => {
			const previous = state;
			state = reconnectPolicy(state, event);
			if (state.phase === previous.phase) return;

			setConnectionState(connectionStateOf(state.phase));
			clearRetryTimer();
			// connected continues the opening attempt's stream; every other
			// phase change ends it.
			if (state.phase.kind !== "connected") stopAttempt();

			const phase = state.phase;
			switch (phase.kind) {
				case "minting":
					attempt = new AbortController();
					void mint(attempt.signal);
					break;
				case "opening":
					attempt = new AbortController();
					void openStream(phase.token, attempt.signal);
					break;
				case "waiting":
					retryTimer = setTimeout(
						() => dispatch({ type: "timer_fired", nowMs: Date.now() }),
						Math.max(0, phase.untilMs - Date.now()),
					);
					break;
				case "connected":
				case "paused":
				case "forbidden":
					break;
			}
		};

		const streamFailed = (retryAfterMs?: number) =>
			dispatch({
				type: "stream_failed",
				nowMs: Date.now(),
				random: Math.random(),
				retryAfterMs,
			});

		const mint = async (signal: AbortSignal) => {
			try {
				const { token, expiresInMs } = await getAccountEventsToken({
					data: undefined,
				});
				if (signal.aborted) return;
				const nowMs = Date.now();
				dispatch({
					type: "mint_succeeded",
					token: { value: token, expiresAtMs: nowMs + expiresInMs },
					nowMs,
				});
			} catch {
				if (signal.aborted) return;
				dispatch({
					type: "mint_failed",
					nowMs: Date.now(),
					random: Math.random(),
				});
			}
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
						activeJobsKeys.byAccount(accountId),
						(old) => applyJobProgressChanged(old, envelope.data),
					);
					break;
				case "enrichment_completed":
				case "enrichment_stopped":
					invalidateEnrichmentCompletionQueries(queryClient, accountId);
					break;
				case "extension_sync_completed":
					void invalidateLibrarySyncQueries(queryClient, accountId);
					break;
				case "match_snapshot_published":
					queryClient.invalidateQueries({ queryKey: matchDeckKeys.deckRoot });
					break;
				// The gateway follows every replay batch with an authoritative
				// active_jobs_snapshot frame, so job-change frames need no
				// invalidate/refetch roundtrip — the snapshot lands via
				// setQueryData in the same batch.
				case "match_snapshot_failed":
				case "active_jobs_changed":
					break;
				case "match_deck_appended":
					queryClient.invalidateQueries({
						queryKey: matchDeckKeys.deck(accountId, envelope.data.orientation),
					});
					break;
				case "billing_state_changed":
					void invalidateEntitlementQueries(queryClient);
					break;
				case "token_expiring":
					dispatch({ type: "token_expiring", nowMs: Date.now() });
					break;
				case "error":
					streamFailed();
					break;
				default:
					break;
			}
		};

		const openStream = async (token: string, signal: AbortSignal) => {
			try {
				const headers: Record<string, string> = {
					Accept: "text/event-stream",
					Authorization: `Bearer ${token}`,
				};
				if (lastSeenPublishIdRef.current !== undefined) {
					headers["Last-Event-ID"] = lastSeenPublishIdRef.current.toString();
				}

				const response = await fetch(streamUrl, { headers, signal });

				if (signal.aborted) return;

				if (response.status === 401) {
					dispatch({
						type: "token_rejected",
						nowMs: Date.now(),
						random: Math.random(),
					});
					return;
				}
				if (response.status === 403) {
					dispatch({ type: "forbidden" });
					return;
				}
				if (!response.ok) {
					streamFailed(parseRetryAfterMs(response.headers.get("Retry-After")));
					return;
				}

				// On a cursor-less connect the gateway skips history and announces
				// the starting cursor here. Seed it so a reconnect before the first
				// durable frame still sends Last-Event-ID — without it the gateway
				// would treat the reconnect as another fresh page load and skip
				// events published in the gap.
				if (lastSeenPublishIdRef.current === undefined) {
					const startCursor = parseInt(
						response.headers.get(CURSOR_RESPONSE_HEADER) ?? "",
						10,
					);
					if (!Number.isNaN(startCursor)) {
						lastSeenPublishIdRef.current = startCursor;
					}
				}

				dispatch({ type: "stream_opened" });

				if (!response.body) {
					streamFailed();
					return;
				}

				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					if (signal.aborted) return;

					buffer += decoder.decode(value, { stream: true });

					let splitIndex = buffer.indexOf("\n\n");
					while (splitIndex >= 0) {
						const frameStr = buffer.slice(0, splitIndex);
						buffer = buffer.slice(splitIndex + 2);
						processFrame(frameStr);
						// A control frame (token_expiring, error) ends this stream.
						if (signal.aborted) return;
						splitIndex = buffer.indexOf("\n\n");
					}
				}

				if (signal.aborted) return;
				streamFailed();
			} catch {
				if (signal.aborted) return;
				streamFailed();
			}
		};

		const onVisibilityChange = () =>
			dispatch({
				type: "visibility_changed",
				hidden: document.hidden,
				nowMs: Date.now(),
			});

		setConnectionState(connectionStateOf(state.phase));
		document.addEventListener("visibilitychange", onVisibilityChange);
		onVisibilityChange();

		return () => {
			document.removeEventListener("visibilitychange", onVisibilityChange);
			clearRetryTimer();
			stopAttempt();
		};
	}, [accountId, enabled, queryClient, setConnectionState]);

	return {
		connectionState,
	};
}
