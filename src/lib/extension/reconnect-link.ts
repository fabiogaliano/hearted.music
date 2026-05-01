import type { MouseEvent } from "react";
import { expectLoginReturn } from "./detect";

/**
 * Arms the extension's expected-login-return signal on intentional navigation
 * to Spotify. Guards against right-click and duplicate fires:
 *
 * - mousedown: only left button (button=0) — fires first, covers normal click
 * - auxclick: only middle button (button=1) — open-in-new-tab
 * - click: only keyboard activation (detail=0) — mouse clicks already handled by mousedown
 */
export function armReconnectOnActivation(event: MouseEvent<HTMLElement>): void {
	if (event.type === "mousedown" && event.button !== 0) return;
	if (event.type === "auxclick" && event.button !== 1) return;
	if (event.type === "click" && event.detail !== 0) return;
	void expectLoginReturn().catch(() => {});
}
