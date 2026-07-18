import { useCallback, useEffect, useState } from "react";
import { browser } from "../shared/browser";
import { DEFAULT_BACKEND_URL } from "../shared/constants";
import type { AccountsResponse } from "../shared/types";
import {
	AccountsPanel,
	type AccountsView,
	type DisconnectSide,
} from "./AccountsPanel";

function isAccountsResponse(value: unknown): value is AccountsResponse {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { type?: unknown }).type === "ACCOUNTS"
	);
}

export function App() {
	const [view, setView] = useState<AccountsView>({ kind: "loading" });
	const [busy, setBusy] = useState<DisconnectSide | null>(null);

	const refresh = useCallback(async () => {
		try {
			// Promise-style sendMessage works on both Chrome MV3 (promise-native)
			// and Firefox's browser.* — a Chrome callback signature would silently
			// never resolve on Firefox.
			const response: unknown = await browser.runtime.sendMessage({
				type: "GET_ACCOUNTS",
			});
			if (!isAccountsResponse(response)) {
				setView({ kind: "error" });
				return;
			}
			setView({
				kind: "loaded",
				spotify: response.spotify,
				hearted: response.hearted,
			});
		} catch {
			setView({ kind: "error" });
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const onDisconnect = useCallback(
		async (side: DisconnectSide) => {
			setBusy(side);
			try {
				await browser.runtime.sendMessage({
					type:
						side === "spotify" ? "DISCONNECT_SPOTIFY" : "DISCONNECT_HEARTED",
				});
			} catch {
				// Fall through to refresh — it re-reads the truth either way.
			}
			await refresh();
			setBusy(null);
		},
		[refresh],
	);

	const onReconnectHearted = useCallback(async () => {
		// Re-pairing mints a token from the site's session cookie, which only a
		// hearted.music page can do — so open the app the user paired from
		// (backendUrl, persisted through disconnect) and let it re-pair.
		const { backendUrl } = await browser.storage.local.get("backendUrl");
		const url =
			typeof backendUrl === "string" ? backendUrl : DEFAULT_BACKEND_URL;
		try {
			await browser.tabs.create({ url });
			window.close();
		} catch {
			// Popup closing races the tab open on some browsers — ignore.
		}
	}, []);

	return (
		<AccountsPanel
			view={view}
			busy={busy}
			onDisconnect={(side) => void onDisconnect(side)}
			onReconnectHearted={() => void onReconnectHearted()}
		/>
	);
}
