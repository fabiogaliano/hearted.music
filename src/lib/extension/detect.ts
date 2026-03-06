/**
 * Extension detection via externally_connectable messaging.
 * Uses PING/PONG pattern to check if the hearted. Chrome extension is installed.
 */

import { env } from "@/env";

declare const chrome: {
	runtime?: {
		sendMessage: (
			extensionId: string,
			message: unknown,
			callback: (response: { type?: string } | undefined) => void,
		) => void;
		lastError?: { message?: string };
	};
};

const EXTENSION_ID = env.VITE_CHROME_EXTENSION_ID ?? "";

export async function getSpotifyConnectionStatus(): Promise<boolean> {
	if (
		!EXTENSION_ID ||
		typeof chrome === "undefined" ||
		!chrome.runtime?.sendMessage
	) {
		return false;
	}
	const runtime = chrome.runtime;
	try {
		return new Promise((resolve) => {
			runtime.sendMessage(
				EXTENSION_ID,
				{ type: "SPOTIFY_STATUS" },
				(response) => {
					if (runtime.lastError) {
						resolve(false);
						return;
					}
					resolve(
						response?.type === "SPOTIFY_STATUS" &&
							(response as unknown as { hasToken: boolean }).hasToken === true,
					);
				},
			);
		});
	} catch {
		return false;
	}
}

export async function connectExtension(
	token: string,
	backendUrl: string,
): Promise<boolean> {
	if (
		!EXTENSION_ID ||
		typeof chrome === "undefined" ||
		!chrome.runtime?.sendMessage
	) {
		return false;
	}
	const runtime = chrome.runtime;
	try {
		return new Promise((resolve) => {
			runtime.sendMessage(
				EXTENSION_ID,
				{ type: "CONNECT", token, backendUrl },
				(response) => {
					if (runtime.lastError) {
						resolve(false);
						return;
					}
					resolve(response?.type === "CONNECTED");
				},
			);
		});
	} catch {
		return false;
	}
}

export function triggerExtensionSync(): void {
	if (
		!EXTENSION_ID ||
		typeof chrome === "undefined" ||
		!chrome.runtime?.sendMessage
	) {
		return;
	}
	const runtime = chrome.runtime;
	try {
		runtime.sendMessage(EXTENSION_ID, { type: "TRIGGER_SYNC" }, () => {
			if (runtime.lastError) {
				console.warn(
					"[hearted.] triggerExtensionSync:",
					runtime.lastError.message,
				);
			}
		});
	} catch {
		// best-effort fire-and-forget
	}
}

export async function isExtensionInstalled(): Promise<boolean> {
	if (
		!EXTENSION_ID ||
		typeof chrome === "undefined" ||
		!chrome.runtime?.sendMessage
	) {
		return false;
	}
	const runtime = chrome.runtime;
	try {
		return new Promise((resolve) => {
			runtime.sendMessage(EXTENSION_ID, { type: "PING" }, (response) => {
				if (runtime.lastError) {
					resolve(false);
					return;
				}
				resolve(response?.type === "PONG");
			});
		});
	} catch {
		return false;
	}
}
