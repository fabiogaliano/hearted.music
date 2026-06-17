/**
 * SongDetailPanel — the production chrome around SongDetailPanelSurface.
 *
 * SongDetailPanelSurface is a self-contained `position: fixed` read surface with
 * no open/close, navigation, or slide animation. This wrapper supplies that
 * chrome: the slide-in shell, the keyboard shortcuts (escape to close, j/k +
 * arrows to navigate), and the per-song themed palette.
 *
 * The shell carries a `transform`, which makes it the containing block for the
 * surface's fixed root — so giving the shell the same width as the surface lets
 * `translateX` slide the panel by exactly its own width, no edits to the surface
 * required.
 */

import { useReducedMotion } from "framer-motion";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { themes } from "@/lib/theme/colors";
import { getThemedDarkColors } from "../detail/themed-dark-colors";
import {
	type LockedCta,
	SongDetailPanelSurface,
} from "./SongDetailPanelSurface";
import type { PlaylistsPanel, SongDetail } from "./song-detail-types";

// Full-screen overlay on small screens, fixed side panel at lg+ (see --song-panel-width in styles.css).
export const PANEL_WIDTH = "var(--song-panel-width)";

interface SongDetailPanelProps {
	song: SongDetail;
	isExpanded: boolean;
	onClose: () => void;
	onNext: () => void;
	onPrevious: () => void;
	hasNext: boolean;
	hasPrevious: boolean;
	/** Walkthrough mode: append the sticky "See where this song belongs" CTA. */
	isWalkthrough?: boolean;
	/** Enrichment pipeline is running — an unread song shows the "Listening" state. */
	isEnrichmentRunning?: boolean;
	/** Action shown in the locked state (unlock or see-plans), resolved by the page. */
	lockedCta?: LockedCta;
	/** Add-to-playlist matches for the bottom of an analyzed read, resolved by the page. */
	playlists?: PlaylistsPanel;
}

export function SongDetailPanel({
	song,
	isExpanded,
	onClose,
	onNext,
	onPrevious,
	hasNext,
	hasPrevious,
	isWalkthrough = false,
	isEnrichmentRunning = false,
	lockedCta,
	playlists,
}: SongDetailPanelProps) {
	const prefersReducedMotion = useReducedMotion();
	const colors = getThemedDarkColors(themes[song.theme]);
	const panelRef = useRef<HTMLElement>(null);
	const [closeHovered, setCloseHovered] = useState(false);
	const [closePressed, setClosePressed] = useState(false);
	// Lives on the chrome, not the per-song surface (keyed by song.id, remounts on nav), so
	// "read deeper" stays open as you move between songs. Starts collapsed everywhere
	// (walkthrough included) — the headline lands first, then the user opens the take.
	const [readDeeperOpen, setReadDeeperOpen] = useState(false);
	const focusTargetSongId = isExpanded ? song.id : null;

	useEffect(() => {
		if (focusTargetSongId === null) return;
		panelRef.current?.focus({ preventScroll: true });
	}, [focusTargetSongId]);

	useShortcut({
		key: "escape",
		handler: onClose,
		description: "Close detail view",
		scope: "liked-detail",
		category: "actions",
		// The walkthrough locks the panel — its CTA is the only way forward — so Esc
		// can't close it out from under the user mid-step.
		enabled: isExpanded && !isWalkthrough,
	});

	useShortcut({
		key: "k",
		handler: onPrevious,
		description: "Previous song",
		scope: "liked-detail",
		category: "navigation",
		enabled: isExpanded && hasPrevious,
	});

	useShortcut({
		key: "up",
		handler: onPrevious,
		description: "Previous song",
		scope: "liked-detail",
		category: "navigation",
		enabled: isExpanded && hasPrevious,
	});

	useShortcut({
		key: "j",
		handler: onNext,
		description: "Next song",
		scope: "liked-detail",
		category: "navigation",
		enabled: isExpanded && hasNext,
	});

	useShortcut({
		key: "down",
		handler: onNext,
		description: "Next song",
		scope: "liked-detail",
		category: "navigation",
		enabled: isExpanded && hasNext,
	});

	return (
		<>
			{/* Walkthrough only: dim + frost the rest of the page so the panel is the
			    sole focus, and swallow clicks on the list behind it so the user can't
			    accidentally pull themselves out of the step. */}
			{isWalkthrough && (
				<div
					aria-hidden="true"
					style={{
						position: "fixed",
						inset: 0,
						zIndex: 49,
						pointerEvents: isExpanded ? "auto" : "none",
						opacity: isExpanded ? 1 : 0,
						background: "color-mix(in srgb, var(--t-text) 44%, transparent)",
						backdropFilter: "blur(6px)",
						WebkitBackdropFilter: "blur(6px)",
						transition: prefersReducedMotion
							? "opacity 300ms ease"
							: "opacity 300ms var(--ease-out-quart)",
					}}
				/>
			)}
			<section
				ref={panelRef}
				tabIndex={-1}
				aria-label={`${song.title} by ${song.artist}`}
				className="overflow-hidden"
				style={
					{
						// Re-theme the app's focus ring to this song's accent for everything inside
						// the panel (close button + the read's interactive bits). The global --ring
						// is the app-wide purple and clashes with the per-song dark palette; the
						// global :focus-visible rule reads --focus-ring-color, which inherits from here.
						"--focus-ring-color": colors.accent,
						position: "fixed",
						top: 0,
						right: 0,
						zIndex: 50,
						width: PANEL_WIDTH,
						height: "100vh",
						transform: isExpanded ? "translateX(0)" : "translateX(100%)",
						opacity: isExpanded ? 1 : 0,
						pointerEvents: isExpanded ? "auto" : "none",
						// Focus lands here programmatically on open (for the Esc/j/k shortcut scope
						// and screen-reader context), not via keyboard — so the browser's focus ring
						// is just noise. It also escapes the shell's overflow:hidden and paints a
						// stray line in the list to the left. tabIndex is -1, so nothing can focus
						// this by keyboard; suppressing the outline costs no real affordance.
						outline: "none",
						transition: prefersReducedMotion
							? "none"
							: "transform 300ms var(--ease-out-quart), opacity 300ms var(--ease-out-quart)",
					} as CSSProperties & { "--focus-ring-color": string }
				}
			>
				<SongDetailPanelSurface
					key={song.id}
					song={song}
					isExpanded={isExpanded}
					isWalkthrough={isWalkthrough}
					isEnrichmentRunning={isEnrichmentRunning}
					lockedCta={lockedCta}
					playlists={playlists}
					readDeeperOpen={readDeeperOpen}
					onReadDeeperChange={setReadDeeperOpen}
				/>
				{!isWalkthrough && (
					<button
						type="button"
						onClick={onClose}
						onMouseEnter={() => setCloseHovered(true)}
						onMouseLeave={() => {
							setCloseHovered(false);
							setClosePressed(false);
						}}
						onMouseDown={() => setClosePressed(true)}
						onMouseUp={() => setClosePressed(false)}
						aria-label="Close detail view"
						title="Close (Esc)"
						style={{
							position: "absolute",
							// 40×40 min tap area centered on the visible 32px disc (still at top/right:16).
							top: 12,
							right: 12,
							zIndex: 10,
							width: 40,
							height: 40,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							padding: 0,
							border: "none",
							background: "transparent",
							cursor: "pointer",
						}}
					>
						<span
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								width: 32,
								height: 32,
								borderRadius: 16,
								border: `1px solid ${colors.border}`,
								background: `color-mix(in srgb, ${colors.surface} ${
									closeHovered ? 92 : 80
								}%, transparent)`,
								color: closeHovered ? colors.text : colors.textMuted,
								backdropFilter: "blur(6px)",
								// Layered shadow lifts the disc off the hero — reads on any backdrop, unlike the border alone.
								boxShadow:
									"0 1px 2px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.35)",
								transform:
									closePressed && !prefersReducedMotion
										? "scale(0.98)"
										: "scale(1)",
								transition: prefersReducedMotion
									? "none"
									: "background 150ms ease, color 150ms ease, transform 150ms ease",
							}}
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 14 14"
								fill="none"
								aria-hidden="true"
							>
								<path
									d="M1 1L13 13M13 1L1 13"
									stroke="currentColor"
									strokeWidth="1.5"
									strokeLinecap="round"
								/>
							</svg>
						</span>
					</button>
				)}
			</section>
		</>
	);
}
