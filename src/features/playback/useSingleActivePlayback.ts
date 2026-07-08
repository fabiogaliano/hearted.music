import { useCallback, useState } from "react";

/**
 * "One preview at a time" coordination for a list of playable covers. The list
 * owns which row is currently playing; activating a new row flips the previous
 * one's `isPlaybackActive` to false so its iframe pauses. Deliberately local —
 * playback state is scoped to the list that renders the rows, never a global
 * player, so audio can't outlive the rows that spawned it.
 *
 * Pass `resetKey` (e.g. the review item's key) so swapping the subject clears any
 * active preview during render — React's recommended alternative to a reset
 * effect, applied before the children repaint.
 */
export function useSingleActivePlayback(resetKey?: unknown) {
	const [activePlaybackId, setActivePlaybackId] = useState<string | null>(null);

	const [prevResetKey, setPrevResetKey] = useState(resetKey);
	if (resetKey !== prevResetKey) {
		setPrevResetKey(resetKey);
		setActivePlaybackId(null);
	}

	const activatePlayback = useCallback((playbackId: string) => {
		setActivePlaybackId(playbackId);
	}, []);
	const deactivatePlayback = useCallback(() => {
		setActivePlaybackId(null);
	}, []);

	return { activePlaybackId, activatePlayback, deactivatePlayback };
}
