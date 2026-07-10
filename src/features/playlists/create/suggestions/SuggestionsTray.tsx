/**
 * SuggestionsTray — the system-suggested songs feed below the preview.
 *
 * Soft-refresh behaviour: when the suggestions data set changes because the
 * draft config was updated (a real rotation — most/all rows differ), the tray
 * fades out then back in as a unit rather than per-row re-animation. This
 * matches the conceptualization's "debounced soft-refresh". We detect a
 * rotation by fingerprinting the first MAX_VISIBLE song IDs and counting how
 * many changed; a large delta (> ROTATION_THRESHOLD) means the server
 * returned a mostly-new cohort.
 *
 * A single add or dismiss only changes one row (the acted-on song leaves, one
 * backfills from further down the ranking) — that's a small delta, so it's
 * left to AnimatePresence's per-row enter/exit instead of re-triggering the
 * whole-tray fade on top of it.
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
import { useEffect, useRef, useState } from "react";
import type { SingleActivePlayback } from "@/features/playback/useSingleActivePlayback";
import type { SongVM } from "@/lib/domains/playlists/types";
import { cn } from "@/lib/shared/utils/utils";
import { fonts } from "@/lib/theme/fonts";
import { SuggestionRow } from "./SuggestionRow";

const MAX_VISIBLE = 10;

// A rotation (config change or "Refresh suggestions") typically replaces most
// or all of the visible batch. A single add/dismiss replaces exactly one row.
// This threshold separates "just one row changed, let AnimatePresence handle
// it" from "the whole cohort turned over, run the tray-level fade".
const ROTATION_THRESHOLD = 2;

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

	// Fingerprint the current suggestion set so we can detect a full refresh.
	// We compare the joined IDs of the first MAX_VISIBLE items; a change means
	// the server returned a new cohort and the tray should soft-refresh.
	const visible = suggestions.slice(0, MAX_VISIBLE);
	const fingerprint = visible.map((s) => s.id).join(",");
	const prevFingerprintRef = useRef(fingerprint);
	const prevIdsRef = useRef(new Set(visible.map((s) => s.id)));

	const [refreshKey, setRefreshKey] = useState(0);
	const [fading, setFading] = useState(false);

	useEffect(() => {
		if (fingerprint === prevFingerprintRef.current) return;
		prevFingerprintRef.current = fingerprint;

		const currentIds = new Set(visible.map((s) => s.id));
		const changedCount = [...currentIds].filter(
			(id) => !prevIdsRef.current.has(id),
		).length;
		prevIdsRef.current = currentIds;

		if (changedCount <= ROTATION_THRESHOLD) {
			// Single add/dismiss — let AnimatePresence carry the row transition.
			return;
		}

		if (prefersReducedMotion) {
			// Instant swap — no animation
			setRefreshKey((k) => k + 1);
			return;
		}

		// Fade out, then swap the content in, then fade back in.
		setFading(true);
		const id = window.setTimeout(() => {
			setRefreshKey((k) => k + 1);
			setFading(false);
		}, 180);
		return () => window.clearTimeout(id);
	}, [fingerprint, prefersReducedMotion, visible]);

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
		<motion.div
			animate={{ opacity: fading ? 0 : 1 }}
			transition={{
				duration: prefersReducedMotion ? 0 : 0.18,
				ease: "easeInOut",
			}}
		>
			{/* Quiet header */}
			<div className="mb-3 flex items-center justify-between gap-4 px-1">
				<span
					className="theme-text-muted text-xs tabular-nums"
					style={{ fontFamily: fonts.body }}
				>
					{visible.length} suggestion{visible.length !== 1 ? "s" : ""}
				</span>
				<button
					type="button"
					onClick={onRefresh}
					className={cn(
						"theme-text-muted flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1.5",
						"text-[11px] tracking-widest uppercase",
						"transition-opacity duration-150 hover:opacity-70 active:scale-[0.98]",
						"focus-visible:outline-2 focus-visible:outline-offset-2",
						"[outline-color:var(--t-primary)]",
					)}
					style={{ fontFamily: fonts.body, minHeight: 40 }}
				>
					<ArrowsClockwiseIcon size={12} weight="regular" aria-hidden />
					Refresh
				</button>
			</div>

			<ul
				key={refreshKey}
				aria-label="Suggested songs to add"
				className="flex flex-col"
			>
				<AnimatePresence initial={false}>
					{visible.map((song) => (
						<li key={song.id} style={{ listStyle: "none" }}>
							<SuggestionRow
								song={song}
								onAdd={handleAdd}
								onDismiss={handleDismiss}
								playback={playback}
							/>
						</li>
					))}
				</AnimatePresence>
			</ul>
		</motion.div>
	);
}
