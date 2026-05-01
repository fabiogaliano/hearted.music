import { useEffect, useState } from "react";
import { getSpotifyConnectionStatus } from "./detect";

interface ReconnectState {
	key: string;
	reconnectNeeded: boolean;
}

const RECOVERY_POLL_MS = 3_000;

/**
 * Tracks whether a Spotify reconnect prompt should be shown, scoped to an
 * entity key (e.g. song ID, playlist ID). State resets automatically when
 * the key changes, preventing stale reconnect banners from leaking across
 * navigation events.
 *
 * While reconnect is needed, polls the extension every 3 s and auto-clears
 * the state once the token is detected again.
 */
export function useSpotifyReconnectState(entityKey: string): {
	reconnectNeeded: boolean;
	setReconnectNeeded: (value: boolean) => void;
} {
	const [state, setState] = useState<ReconnectState>({
		key: entityKey,
		reconnectNeeded: false,
	});

	useEffect(() => {
		if (state.key === entityKey) return;
		setState({ key: entityKey, reconnectNeeded: false });
	}, [entityKey, state.key]);

	const reconnectNeeded =
		state.key === entityKey ? state.reconnectNeeded : false;

	useEffect(() => {
		if (!reconnectNeeded) return;

		let cancelled = false;
		const check = async () => {
			const connected = await getSpotifyConnectionStatus();
			if (!cancelled && connected) {
				setState((prev) =>
					prev.key === entityKey ? { ...prev, reconnectNeeded: false } : prev,
				);
			}
		};

		const id = setInterval(check, RECOVERY_POLL_MS);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [entityKey, reconnectNeeded]);

	return {
		reconnectNeeded,
		setReconnectNeeded: (value: boolean) =>
			setState((prev) => ({ ...prev, reconnectNeeded: value })),
	};
}
