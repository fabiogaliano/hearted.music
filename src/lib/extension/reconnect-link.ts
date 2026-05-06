import type { MouseEvent } from "react";
import { expectLoginReturn } from "./detect";

// MUST stay in sync with extension/src/content/spotify-token.ts.
export const ARM_TOKEN_FRAGMENT_PARAM = "hearted-arm";

/**
 * Pure activation predicate. Arming happens only on activation events that
 * actually open the new tab — never on `mousedown`, which fires for canceled
 * clicks (drag-aborts, context menus, button-up outside element). Right-click
 * (button=2) is excluded because Chrome dispatches `contextmenu`, not `click`.
 *
 *   - `click`     → left-click activation (button=0) and keyboard activation
 *                   (detail=0). Both arm.
 *   - `auxclick`  → middle-click open-in-new-tab (button=1). Arms.
 *   - everything else → no arm.
 */
export function shouldArmOnEvent(event: {
	type: string;
	button: number;
	detail: number;
}): boolean {
	if (event.type === "click") {
		return event.button === 0;
	}
	if (event.type === "auxclick") {
		return event.button === 1;
	}
	return false;
}

function setArmTokenInHash(url: URL, armToken: string): void {
	const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
	const params = new URLSearchParams(hash);
	params.set(ARM_TOKEN_FRAGMENT_PARAM, armToken);
	url.hash = params.toString();
}

/**
 * Returns a URL string whose eventual Spotify destination carries the
 * `hearted-arm` fragment param. Direct open.spotify.com URLs are armed in
 * place; accounts.spotify.com login wrappers arm their `continue` destination
 * so the token survives the redirect into Spotify.
 */
export function buildArmedSpotifyUrl(
	baseUrl: string,
	armToken: string,
): string {
	try {
		const url = new URL(baseUrl);
		const continueUrl = url.searchParams.get("continue");
		if (continueUrl) {
			url.searchParams.set(
				"continue",
				buildArmedSpotifyUrl(continueUrl, armToken),
			);
			return url.toString();
		}
		setArmTokenInHash(url, armToken);
		return url.toString();
	} catch {
		const sep = baseUrl.includes("#") ? "&" : "#";
		return `${baseUrl}${sep}${ARM_TOKEN_FRAGMENT_PARAM}=${encodeURIComponent(armToken)}`;
	}
}

/**
 * Builds a click/auxclick handler that keeps SSR markup deterministic by
 * generating the arm token only at activation time, then opening the armed URL
 * imperatively. This follows React/TanStack hydration guidance: render a
 * stable href on the server and do browser-only work in the event handler.
 */
export function armReconnectOnActivation(
	baseUrl: string,
): (event: MouseEvent<HTMLElement>) => void {
	return (event) => {
		if (!shouldArmOnEvent(event)) return;
		event.preventDefault();
		const armToken = crypto.randomUUID();
		const armedUrl = buildArmedSpotifyUrl(baseUrl, armToken);
		void expectLoginReturn(armToken).catch(() => {});
		window.open(armedUrl, "_blank", "noopener,noreferrer");
	};
}
