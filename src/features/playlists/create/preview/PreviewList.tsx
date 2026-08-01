/**
 * PreviewList — the live preview of the draft playlist.
 *
 * Rows crossfade in place when filters replace the cohort. A single removal
 * fades only that row while the survivors close the gap, so list updates never
 * imply a direction the user's action did not have. Reduced motion swaps rows
 * instantly.
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

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { SingleActivePlayback } from "@/features/playback/useSingleActivePlayback";
import type { SongVM } from "@/lib/domains/playlists/types";
import { fonts } from "@/lib/theme/fonts";
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
	 * Effective pinned ids (manual picks + artist-derived). Rows with a pinned
	 * id render with a FILLED pin icon; the draft engine already orders
	 * pins-first in the tracklist.
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
	const prefersReducedMotion = useReducedMotion();
	const pinnedSet = new Set(pinnedSongIds ?? []);
	const songCount = songs.length;

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
		if (playback?.activePlaybackId === song.id) {
			playback.deactivatePlayback();
		}
		onRemoveSong(song.id);
		toast(
			<span className="toast-line">
				<span className="toast-line-verb">Removed</span>
				<span className="toast-line-subject">
					{song.name}
					<span className="toast-line-artist">{song.artist}</span>
				</span>
			</span>,
			{
				action: {
					label: "Undo",
					onClick: () => onRestoreSong(song.id),
				},
			},
		);
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
			<div aria-live="polite" aria-atomic="true" className="sr-only">
				{announcement}
			</div>

			<ul aria-label="Preview playlist songs" className="flex flex-col">
				<AnimatePresence initial={false} mode="popLayout">
					{songs.map((song) => (
						<motion.li
							key={song.id}
							layout={prefersReducedMotion ? false : "position"}
							initial={prefersReducedMotion ? false : { opacity: 0 }}
							animate={{
								opacity: 1,
								transition: {
									duration: prefersReducedMotion ? 0 : 0.14,
									ease: [0.25, 1, 0.5, 1],
								},
							}}
							exit={{
								opacity: 0,
								transition: {
									duration: prefersReducedMotion ? 0 : 0.1,
									ease: [0.25, 1, 0.5, 1],
								},
							}}
							transition={{
								layout: {
									duration: prefersReducedMotion ? 0 : 0.18,
									ease: [0.77, 0, 0.175, 1],
								},
							}}
							style={{ listStyle: "none" }}
						>
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
						</motion.li>
					))}
				</AnimatePresence>
			</ul>
		</div>
	);
}
