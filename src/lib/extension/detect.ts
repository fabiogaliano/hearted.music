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
	if (!EXTENSION_ID) {
		console.warn(
			"[hearted.detect] EXTENSION_ID is empty — check VITE_CHROME_EXTENSION_ID in .env",
		);
		return false;
	}
	if (typeof chrome === "undefined") {
		console.warn(
			"[hearted.detect] chrome global is undefined — not running in Chrome?",
		);
		return false;
	}
	if (!chrome.runtime?.sendMessage) {
		console.warn(
			"[hearted.detect] chrome.runtime.sendMessage unavailable — extension not installed or externally_connectable mismatch",
			{
				hasRuntime: !!chrome.runtime,
				origin: window.location.origin,
				extensionId: EXTENSION_ID,
			},
		);
		return false;
	}
	const runtime = chrome.runtime;
	try {
		return new Promise((resolve) => {
			runtime.sendMessage(EXTENSION_ID, { type: "PING" }, (response) => {
				if (runtime.lastError) {
					console.warn(
						"[hearted.detect] PING failed:",
						runtime.lastError.message,
					);
					resolve(false);
					return;
				}
				const detected = response?.type === "PONG";
				if (!detected) {
					console.warn("[hearted.detect] Unexpected PING response:", response);
				}
				resolve(detected);
			});
		});
	} catch (err) {
		console.warn("[hearted.detect] sendMessage threw:", err);
		return false;
	}
}
