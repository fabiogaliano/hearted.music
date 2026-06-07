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
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { themes } from "@/lib/theme/colors";
import { getThemedDarkColors } from "../detail/themed-dark-colors";
import type { ConceptSong } from "./concept-types";
import { SongDetailPanelSurface } from "./SongDetailPanelSurface";

const PANEL_WIDTH = "clamp(440px, 50vw, 760px)";

interface SongDetailPanelProps {
	song: ConceptSong;
	isExpanded: boolean;
	onClose: () => void;
	onNext: () => void;
	onPrevious: () => void;
	hasNext: boolean;
	hasPrevious: boolean;
	/** Walkthrough mode: append the sticky "See where this song belongs" CTA. */
	isWalkthrough?: boolean;
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
}: SongDetailPanelProps) {
	const prefersReducedMotion = useReducedMotion();
	const colors = getThemedDarkColors(themes[song.theme]);

	useShortcut({
		key: "escape",
		handler: onClose,
		description: "Close detail view",
		scope: "liked-detail",
		category: "actions",
		enabled: isExpanded,
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
		<div
			className="overflow-hidden"
			style={{
				position: "fixed",
				top: 0,
				right: 0,
				zIndex: 50,
				width: PANEL_WIDTH,
				height: "100vh",
				transform: isExpanded ? "translateX(0)" : "translateX(100%)",
				opacity: isExpanded ? 1 : 0,
				pointerEvents: isExpanded ? "auto" : "none",
				transition: prefersReducedMotion
					? "none"
					: "transform 300ms var(--ease-out-quart), opacity 300ms var(--ease-out-quart)",
			}}
		>
			<SongDetailPanelSurface
				key={song.id}
				song={song}
				isWalkthrough={isWalkthrough}
			/>
			<button
				type="button"
				onClick={onClose}
				aria-label="Close detail view"
				title="Close (Esc)"
				style={{
					position: "absolute",
					top: 16,
					right: 16,
					zIndex: 10,
					width: 32,
					height: 32,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					borderRadius: 16,
					border: `1px solid ${colors.border}`,
					background: `color-mix(in srgb, ${colors.surface} 80%, transparent)`,
					color: colors.textMuted,
					cursor: "pointer",
					backdropFilter: "blur(6px)",
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
			</button>
		</div>
	);
}
