/**
 * Tiny shared signal for "a blocking confirmation modal is open."
 *
 * The old flows used native window.confirm, which froze the event loop so no
 * queue keyboard shortcut could fire while a destructive confirmation was up.
 * ConfirmModal is non-blocking, so we replicate that guarantee explicitly: the
 * modal registers itself while mounted and queue-keyboard bails whenever the
 * count is non-zero. Keeps the plan's "a shortcut may only open, never commit, a
 * destructive action" rule intact.
 */

let openCount = 0;

export function registerOpenModal(): () => void {
	openCount += 1;
	return () => {
		openCount = Math.max(0, openCount - 1);
	};
}

export function isModalOpen(): boolean {
	return openCount > 0;
}
