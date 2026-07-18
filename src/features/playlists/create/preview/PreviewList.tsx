/**
 * PreviewList — the live preview of the draft playlist.
 *
 * Displays a count/duration header ("15 songs · about 50 min") with
 * tabular-nums to prevent layout shift as the count updates. Row enter/exit
 * animations are managed by framer-motion AnimatePresence with initial={false}
 * so the initial render lands without any entrance animation. Reduced motion
 * collapses all transitions to instant opacity changes.
 *
 * Remove triggers a sonner toast with an Undo action. The `restoreSong`
 * callback (from the draft hook) reverses the exclusion without force-pinning,
 * so the song re-enters only if the current config still selects it.
 *
 * `playback`, when supplied, is the coordinator shared with the suggestions
 * tray (see CreatePlaylistScreen) so only one preview plays across the whole
 * screen. Removing the row that's currently playing deactivates it first —
 * the embed unmounts either way, but this also frees the coordinator's active
 * id immediately rather than leaving it pointed at a gone row.
 */

import { AnimatePresence } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { SingleActivePlayback } from "@/features/playback/useSingleActivePlayback";
import type { SongVM } from "@/lib/domains/playlists/types";
import { fonts } from "@/lib/theme/fonts";
import { approximateDuration } from "../MaxSongsSlider";
import { PreviewSongRow } from "./PreviewSongRow";

interface PreviewListProps {
	songs: SongVM[];
	isLoading: boolean;
	onRemoveSong: (id: string) => void;
	/** Reverses a remove without force-pinning the song back in. */
	onRestoreSong: (id: string) => void;
	/**
	 * Flip a row's pin. The draft module owns the policy (pin an unpinned row,
	 * release a pinned one). Release is non-destructive — the song stays
	 * eligible on merit — so no remove feedback is mirrored here; the undo
	 * toast belongs to remove, the only banishing gesture.
	 * Omitted → rows render without a pin toggle (isolated consumers, stories).
	 */
	onTogglePin?: (id: string) => void;
	/** IDs of songs that just entered the preview (recently added). */
	newSongIds?: ReadonlySet<string>;
	/**
	 * Effective pinned ids (manual picks + artist-derived). These lead the
	 * tracklist and render with a FILLED pin — the picks are pinned by default,
	 * which is what distinguishes them from the engine's matched fill (no zone
	 * labels; the pin marker carries the distinction).
	 */
	pinnedSongIds?: readonly string[];
	/** Shared "one preview at a time" coordinator; see CreatePlaylistScreen.
	 *  Omitted → rows fall back to plain static covers (no play affordance). */
	playback?: SingleActivePlayback;
}

export function PreviewList({
	songs,
	isLoading,
	onRemoveSong,
	onRestoreSong,
	onTogglePin,
	newSongIds,
	pinnedSongIds,
	playback,
}: PreviewListProps) {
	const pinnedSet = new Set(pinnedSongIds ?? []);
	const songCount = songs.length;
	const durationHint = approximateDuration(songCount);

	// Only announce count changes after the initial mount — avoid reading out
	// the full count on page load. The live region is always in the DOM but
	// stays empty until a real add/remove occurs.
	const prevCountRef = useRef<number | null>(null);
	const [announcement, setAnnouncement] = useState("");

	useEffect(() => {
		if (prevCountRef.current === null) {
			prevCountRef.current = songCount;
			return;
		}
		if (songCount !== prevCountRef.current) {
			prevCountRef.current = songCount;
			setAnnouncement(
				songCount === 0
					? "Playlist preview is empty"
					: `${songCount} ${songCount === 1 ? "song" : "songs"} in preview`,
			);
		}
	}, [songCount]);

	function handleRemove(song: SongVM) {
		// A removed row that's mid-preview would otherwise leave the coordinator
		// pointing at a playbackId that no longer exists — deactivate first so a
		// stale active id can't block the next row from taking over.
		if (playback?.activePlaybackId === song.id) {
			playback.deactivatePlayback();
		}
		onRemoveSong(song.id);
		toast(`Removed ${song.name}`, {
			action: {
				label: "Undo",
				onClick: () => onRestoreSong(song.id),
			},
		});
	}

	if (isLoading && songCount === 0) {
		return (
			<p
				className="theme-text-muted py-6 text-sm"
				style={{ fontFamily: fonts.body }}
			>
				One moment…
			</p>
		);
	}

	if (songCount === 0) {
		return (
			<p
				className="theme-text-muted py-6 text-sm"
				style={{ fontFamily: fonts.body }}
			>
				No songs matched the current filters. Broaden your selection to see a
				preview.
			</p>
		);
	}

	return (
		<div>
			{/* Screen-reader live region: only fires on actual add/remove, not initial mount */}
			<div aria-live="polite" aria-atomic="true" className="sr-only">
				{announcement}
			</div>

			{/* Count + duration header */}
			<div className="mb-3 flex items-baseline gap-2 px-1">
				<span
					className="theme-text-muted text-xs tabular-nums"
					style={{ fontFamily: fonts.body }}
				>
					{songCount} {songCount === 1 ? "song" : "songs"}
				</span>
				<span
					className="theme-text-muted text-xs opacity-40"
					aria-hidden="true"
				>
					·
				</span>
				<span
					className="theme-text-muted text-xs tabular-nums"
					style={{ fontFamily: fonts.body }}
				>
					{durationHint}
				</span>
			</div>

			{/* Song rows — AnimatePresence manages enter/exit per row. Picks (pinned)
			    lead the tracklist with a filled pin; matched fill follows unfilled.
			    No zone labels: the pin marker alone carries the distinction. */}
			<ul aria-label="Preview playlist songs" className="flex flex-col">
				<AnimatePresence initial={false}>
					{songs.map((song) => (
						<li key={song.id} style={{ listStyle: "none" }}>
							<PreviewSongRow
								song={song}
								onRemove={() => handleRemove(song)}
								isPinned={pinnedSet.has(song.id)}
								onTogglePin={
									onTogglePin ? () => onTogglePin(song.id) : undefined
								}
								isNew={newSongIds?.has(song.id) ?? false}
								playback={playback}
							/>
						</li>
					))}
				</AnimatePresence>
			</ul>
		</div>
	);
}
