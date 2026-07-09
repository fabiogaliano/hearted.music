/**
 * SuggestionsTray — the system-suggested songs feed below the preview.
 *
 * Soft-refresh behaviour: when the suggestions data set changes (because the
 * draft config was updated), the tray fades out then back in as a unit rather
 * than per-row re-animation. This matches the conceptualization's "debounced
 * soft-refresh" — the debounce already lives in the draft hook so we just react
 * to the data changing. We detect a set change by fingerprinting the first song
 * IDs; when the fingerprint changes, a brief fade cycle runs.
 *
 * Add is optimistic: the draft hook's addSong immediately moves the song into
 * pinnedSongIds (and therefore into the preview), so the row disappears from
 * the tray on the next render without a network round-trip.
 *
 * Cap at MAX_VISIBLE suggestions to keep the tray calm.
 */

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { SongVM } from "@/lib/domains/playlists/types";
import { fonts } from "@/lib/theme/fonts";
import { SuggestionRow } from "./SuggestionRow";

const MAX_VISIBLE = 10;

interface SuggestionsTrayProps {
	suggestions: SongVM[];
	onAddSong: (id: string) => void;
}

export function SuggestionsTray({
	suggestions,
	onAddSong,
}: SuggestionsTrayProps) {
	const prefersReducedMotion = useReducedMotion();

	// Fingerprint the current suggestion set so we can detect a full refresh.
	// We compare the joined IDs of the first MAX_VISIBLE items; a change means
	// the server returned a new cohort and the tray should soft-refresh.
	const visible = suggestions.slice(0, MAX_VISIBLE);
	const fingerprint = visible.map((s) => s.id).join(",");
	const prevFingerprintRef = useRef(fingerprint);

	const [refreshKey, setRefreshKey] = useState(0);
	const [fading, setFading] = useState(false);

	useEffect(() => {
		if (fingerprint === prevFingerprintRef.current) return;
		prevFingerprintRef.current = fingerprint;

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
	}, [fingerprint, prefersReducedMotion]);

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
			<div className="mb-3 px-1">
				<span
					className="theme-text-muted text-xs tabular-nums"
					style={{ fontFamily: fonts.body }}
				>
					{visible.length} suggestion{visible.length !== 1 ? "s" : ""}
				</span>
			</div>

			<ul
				key={refreshKey}
				aria-label="Suggested songs to add"
				className="flex flex-col"
			>
				{visible.map((song) => (
					<li key={song.id} style={{ listStyle: "none" }}>
						<SuggestionRow song={song} onAdd={onAddSong} />
					</li>
				))}
			</ul>
		</motion.div>
	);
}
