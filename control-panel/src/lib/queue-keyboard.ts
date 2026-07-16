import { useEffect, useRef } from "react";
import { isModalOpen } from "./modal-open";

export interface QueueKeyHandlers {
	onNext?: () => void;
	onPrev?: () => void;
	onApprove?: () => void;
	onReject?: () => void;
	onSearch?: () => void;
	onEscape?: () => void;
	// Space toggles the embedded player; separate from the others because it needs
	// to preventDefault (Space would otherwise scroll the page).
	onPlayPause?: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName;
	return (
		tag === "INPUT" ||
		tag === "TEXTAREA" ||
		tag === "SELECT" ||
		target.isContentEditable
	);
}

/**
 * Queue keyboard shortcuts: J/K move, A approves, / focuses search, Escape
 * closes an open form. Shortcuts never fire while the operator is typing in a
 * field — except Escape, which is the standard "get me out of this input" key.
 * The ConfirmModal is non-blocking, so it registers an open-modal signal; while
 * any confirmation is open every shortcut here bails (the modal owns Escape),
 * preserving the plan's "a shortcut may only open, never commit, a destructive
 * action" guarantee.
 */
export function useQueueKeyboard(
	handlers: QueueKeyHandlers,
	enabled = true,
): void {
	const ref = useRef(handlers);
	ref.current = handlers;

	useEffect(() => {
		if (!enabled) return;
		function onKey(event: KeyboardEvent) {
			// A confirmation modal owns the keyboard while open (including Escape,
			// which it uses to dismiss itself).
			if (isModalOpen()) return;
			if (event.key === "Escape") {
				ref.current.onEscape?.();
				return;
			}
			if (isTypingTarget(event.target)) return;
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			switch (event.key) {
				case "j":
				case "J":
					event.preventDefault();
					ref.current.onNext?.();
					break;
				case "k":
				case "K":
					event.preventDefault();
					ref.current.onPrev?.();
					break;
				case "a":
				case "A":
					ref.current.onApprove?.();
					break;
				case "r":
				case "R":
					ref.current.onReject?.();
					break;
				case " ":
					// Only claim Space when a player is actually wired up, so queues
					// without one keep native scroll behavior.
					if (ref.current.onPlayPause) {
						event.preventDefault();
						ref.current.onPlayPause();
					}
					break;
				case "/":
					event.preventDefault();
					ref.current.onSearch?.();
					break;
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [enabled]);
}
