/**
 * SuggestionsTray — the system-suggested songs feed below the preview.
 *
 * Suggestion changes crossfade in place. A single add or dismiss fades only
 * that row while the survivors close the gap; a refreshed cohort uses the
 * same stable crossfade rather than first rendering the new rows, hiding them,
 * and revealing them again.
 *
 * Add is optimistic: the draft hook's addSong immediately moves the song into
 * pinnedSongIds (and therefore into the preview), so the row disappears from
 * the tray on the next render without a network round-trip. Dismiss is the
 * same shape via excludedSongIds (see useCreatePlaylistDraft.dismissSuggestion).
 *
 * Cap at MAX_VISIBLE suggestions to keep the tray calm.
 *
 * `playback`, when supplied, is the coordinator shared with the preview list
 * (see CreatePlaylistScreen) so only one preview plays across the whole
 * screen. Adding or dismissing the row that's currently playing deactivates
 * it first — the embed unmounts either way, but this also frees the
 * coordinator's active id immediately rather than leaving it pointed at a
 * gone row.
 */

import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { SingleActivePlayback } from "@/features/playback/useSingleActivePlayback";
import type { SongVM } from "@/lib/domains/playlists/types";
import { cn } from "@/lib/shared/utils/utils";
import { fonts } from "@/lib/theme/fonts";
import { SuggestionRow } from "./SuggestionRow";

const MAX_VISIBLE = 10;

interface SuggestionsTrayProps {
	suggestions: SongVM[];
	onAddSong: (id: string) => void;
	onDismissSong: (id: string) => void;
	/** Pulls a new batch (pages deeper) without changing config. */
	onRefresh: () => void;
	/** Shared "one preview at a time" coordinator; see CreatePlaylistScreen.
	 *  Omitted → rows fall back to plain static covers (no play affordance). */
	playback?: SingleActivePlayback;
}

export function SuggestionsTray({
	suggestions,
	onAddSong,
	onDismissSong,
	onRefresh,
	playback,
}: SuggestionsTrayProps) {
	const prefersReducedMotion = useReducedMotion();

	// A song that's actively previewing and then gets added/dismissed would
	// otherwise leave the coordinator pointing at a playbackId that no longer
	// exists — deactivate first so a stale active id can't block the next row.
	const handleAdd = (id: string) => {
		if (playback?.activePlaybackId === id) playback.deactivatePlayback();
		onAddSong(id);
	};
	const handleDismiss = (id: string) => {
		if (playback?.activePlaybackId === id) playback.deactivatePlayback();
		onDismissSong(id);
	};

	const visible = suggestions.slice(0, MAX_VISIBLE);

	if (visible.length === 0) {
		return (
			<p
				className="theme-text-muted py-6 text-sm"
				style={{ fontFamily: fonts.body }}
			>
				No suggestions yet. Try adjusting your filters.
			</p>
		);
	}

	return (
		<div>
			<div className="mb-3 flex items-center justify-between gap-4">
				<span
					className="theme-text-muted text-[11px] tracking-[0.18em] uppercase"
					style={{ fontFamily: fonts.body }}
				>
					Suggestions
				</span>
				<button
					type="button"
					onClick={onRefresh}
					aria-label="Refresh suggestions"
					className={cn(
						"theme-text-muted flex cursor-pointer items-center rounded-full p-1.5",
						"transition-[opacity,transform] duration-150 hover:opacity-70 active:scale-[0.98]",
						"focus-edge",
					)}
					style={{ minHeight: 32 }}
				>
					<ArrowsClockwiseIcon size={13} weight="regular" aria-hidden />
				</button>
			</div>

			<ul aria-label="Suggested songs to add" className="flex flex-col">
				<AnimatePresence initial={false} mode="popLayout">
					{visible.map((song) => (
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
							<SuggestionRow
								song={song}
								onAdd={handleAdd}
								onDismiss={handleDismiss}
								playback={playback}
							/>
						</motion.li>
					))}
				</AnimatePresence>
			</ul>
		</div>
	);
}
