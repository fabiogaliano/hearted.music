import type { MouseEvent } from "react";
import { expectLoginReturn } from "./detect";

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

export function armReconnectOnActivation(event: MouseEvent<HTMLElement>): void {
	if (!shouldArmOnEvent(event)) return;
	void expectLoginReturn().catch(() => {});
}
