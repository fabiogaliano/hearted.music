/**
 * Landing hero panel: the production SongDetailPanelSurface, embedded in the hero's
 * right-half layer instead of pinned to the viewport. This is the same read surface the
 * app renders — the landing no longer keeps its own copy. The only landing-specific
 * chrome is the prev/next carousel (buttons + horizontal swipe) that cycles featured
 * songs, which the app gets from its list/keyboard instead. The nav buttons reuse the
 * exact disc styling of the app panel's close (X) button so they read as the same chrome.
 */
import { useRef, useState } from "react";
import { getThemedLightColors } from "@/features/liked-songs/components/detail/themed-light-colors";
import { SongDetailPanelSurface } from "@/features/liked-songs/components/song-detail-panel/SongDetailPanelSurface";
import type { SongDetail } from "@/features/liked-songs/components/song-detail-panel/song-detail-types";
import { themes } from "@/lib/theme/colors";

const SWIPE_MIN_DISTANCE_PX = 44;

type Palette = ReturnType<typeof getThemedLightColors>;

interface LandingPanelProps {
	song: SongDetail;
	onPrev: () => void;
	onNext: () => void;
}

function NavArrow({
	direction,
	onClick,
	colors,
}: {
	direction: "prev" | "next";
	onClick: () => void;
	colors: Palette;
}) {
	const [hovered, setHovered] = useState(false);
	const [pressed, setPressed] = useState(false);

	return (
		<button
			type="button"
			onClick={onClick}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => {
				setHovered(false);
				setPressed(false);
			}}
			onMouseDown={() => setPressed(true)}
			onMouseUp={() => setPressed(false)}
			aria-label={direction === "prev" ? "Previous song" : "Next song"}
			title={direction === "prev" ? "Previous" : "Next"}
			style={{
				// 40×40 min tap area centered on the visible 32px disc — matches the panel's close button.
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
						hovered ? 92 : 80
					}%, transparent)`,
					color: hovered ? colors.text : colors.textMuted,
					backdropFilter: "blur(6px)",
					boxShadow:
						"0 1px 2px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.35)",
					transform: pressed ? "scale(0.98)" : "scale(1)",
					transition:
						"background 150ms ease, color 150ms ease, transform 150ms ease",
				}}
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					aria-hidden="true"
				>
					<path
						d={direction === "prev" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"}
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			</span>
		</button>
	);
}

export function LandingPanel({ song, onPrev, onNext }: LandingPanelProps) {
	const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
	const colors = getThemedLightColors(themes[song.theme]);

	const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
		const touch = event.touches[0];
		swipeStartRef.current = touch
			? { x: touch.clientX, y: touch.clientY }
			: null;
	};

	const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
		const start = swipeStartRef.current;
		swipeStartRef.current = null;
		const touch = event.changedTouches[0];
		if (!start || !touch) return;

		const deltaX = touch.clientX - start.x;
		// Horizontal-only: a swipe that's mostly vertical is a scroll, not a song change.
		if (
			Math.abs(deltaX) < SWIPE_MIN_DISTANCE_PX ||
			Math.abs(deltaX) <= Math.abs(touch.clientY - start.y)
		) {
			return;
		}
		(deltaX < 0 ? onNext : onPrev)();
	};

	return (
		<div
			className="relative h-full w-full"
			onTouchStart={handleTouchStart}
			onTouchEnd={handleTouchEnd}
		>
			{/* Keyed so the surface's per-song entrance (concept-rise) replays on each change. */}
			<SongDetailPanelSurface
				key={song.id}
				song={song}
				variant="embedded"
				colorMode="light"
			/>
			<div
				style={{
					position: "absolute",
					top: 12,
					right: 12,
					zIndex: 10,
					display: "flex",
					alignItems: "center",
					gap: 4,
				}}
			>
				<NavArrow direction="prev" onClick={onPrev} colors={colors} />
				<NavArrow direction="next" onClick={onNext} colors={colors} />
			</div>
		</div>
	);
}
