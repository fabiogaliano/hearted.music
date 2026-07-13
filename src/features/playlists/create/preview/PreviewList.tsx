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
	/** IDs of songs that just entered the preview (recently added). */
	newSongIds?: ReadonlySet<string>;
	/**
	 * Effective pinned ids (user picks + artist-derived). The tracklist leads
	 * with pins, so the leading run of songs found in this set is labeled
	 * "Your picks" and the rest "Matched for you" — purely typographic
	 * ownership eyebrows, no per-row badges.
	 */
	pinnedSongIds?: readonly string[];
	/** Shared "one preview at a time" coordinator; see CreatePlaylistScreen.
	 *  Omitted → rows fall back to plain static covers (no play affordance). */
	playback?: SingleActivePlayback;
}

function SectionEyebrow({ label, count }: { label: string; count: number }) {
	return (
		<div
			className="theme-text-muted pt-1 pb-2 text-[11px] tracking-[0.2em] uppercase"
			style={{ fontFamily: fonts.body }}
		>
			{label} <span aria-hidden="true">·</span>{" "}
			<span className="tabular-nums">{count}</span>
		</div>
	);
}

export function PreviewList({
	songs,
	isLoading,
	onRemoveSong,
	onRestoreSong,
	newSongIds,
	pinnedSongIds,
	playback,
}: PreviewListProps) {
	const songCount = songs.length;
	const durationHint = approximateDuration(songCount);

	// The engine composes the tracklist pins-first, so the pinned block is the
	// leading run of songs whose id is in the pinned set — counting the run
	// (rather than set membership across the whole list) keeps the split honest
	// even if a stale pin id lingers in the set after the engine dropped it.
	const pinnedSet = new Set(pinnedSongIds ?? []);
	let pinnedCount = 0;
	while (pinnedCount < songs.length) {
		const song = songs[pinnedCount];
		if (!song || !pinnedSet.has(song.id)) break;
		pinnedCount++;
	}
	// Eyebrows only appear when there's ownership to disambiguate: a mixed list
	// of picks + engine fill. An all-pins or all-fill list keeps the plain look.
	const showEyebrows = pinnedCount > 0 && pinnedCount < songs.length;

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

			{/* Song rows — AnimatePresence manages enter/exit per row. The section
			    eyebrows live inside the same list (keyed, non-motion children) so
			    row exit animations keep working across the pinned/fill boundary. */}
			<ul aria-label="Preview playlist songs" className="flex flex-col">
				<AnimatePresence initial={false}>
					{showEyebrows && (
						<li key="__eyebrow-picks" style={{ listStyle: "none" }}>
							<SectionEyebrow label="Your picks" count={pinnedCount} />
						</li>
					)}
					{songs.slice(0, pinnedCount).map((song) => (
						<li key={song.id} style={{ listStyle: "none" }}>
							<PreviewSongRow
								song={song}
								onRemove={() => handleRemove(song)}
								isNew={newSongIds?.has(song.id) ?? false}
								playback={playback}
							/>
						</li>
					))}
					{showEyebrows && (
						<li key="__eyebrow-fill" style={{ listStyle: "none" }}>
							<SectionEyebrow
								label="Matched for you"
								count={songs.length - pinnedCount}
							/>
						</li>
					)}
					{songs.slice(pinnedCount).map((song) => (
						<li key={song.id} style={{ listStyle: "none" }}>
							<PreviewSongRow
								song={song}
								onRemove={() => handleRemove(song)}
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
