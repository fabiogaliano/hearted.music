import { useCallback, useEffect, useRef, useState } from "react";

const HIGHLIGHT_DURATION_MS = 1500;

interface VisibleSong {
	id: string;
}

export interface SongAddHighlight {
	newSongIds: ReadonlySet<string>;
	markSongAdded: (id: string) => void;
}

/** Keep an add highlight pending until the added row actually reaches the preview. */
export function useSongAddHighlight(
	visibleSongs: readonly VisibleSong[],
): SongAddHighlight {
	const [newSongIds, setNewSongIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
		new Map(),
	);

	useEffect(() => {
		for (const song of visibleSongs) {
			if (!newSongIds.has(song.id) || timeoutsRef.current.has(song.id)) {
				continue;
			}

			const timeout = setTimeout(() => {
				setNewSongIds((current) => {
					const next = new Set(current);
					next.delete(song.id);
					return next;
				});
				timeoutsRef.current.delete(song.id);
			}, HIGHLIGHT_DURATION_MS);
			timeoutsRef.current.set(song.id, timeout);
		}
	}, [visibleSongs, newSongIds]);

	useEffect(() => {
		const timeouts = timeoutsRef.current;
		return () => {
			for (const timeout of timeouts.values()) clearTimeout(timeout);
			timeouts.clear();
		};
	}, []);

	const markSongAdded = useCallback((id: string) => {
		const existingTimeout = timeoutsRef.current.get(id);
		if (existingTimeout !== undefined) {
			clearTimeout(existingTimeout);
			timeoutsRef.current.delete(id);
		}
		setNewSongIds((current) => new Set(current).add(id));
	}, []);

	return { newSongIds, markSongAdded };
}
