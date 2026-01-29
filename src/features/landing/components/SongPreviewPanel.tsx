import { songs } from "@/lib/data/mock-data";
import { type ThemeConfig } from "@/lib/theme/types";
import { fonts } from "@/lib/theme/fonts";
import { extractHue } from "@/lib/utils/color";
import { ThemesList } from "./ThemesList";

// Layout constants matching SongDetailPanel
export const PANEL_LAYOUT = {
	heroHeight: 450,
	albumArtSize: 112,
	paddingX: 20,
	imagePositionY: 30,
};

export interface NavButtonProps {
	direction: "prev" | "next";
	onClick: () => void;
	color: string;
	size?: number;
}

export function NavButton({
	direction,
	onClick,
	color,
	size = 16,
}: NavButtonProps) {
	return (
		<button
			onClick={onClick}
			className="transition-opacity hover:opacity-70"
			aria-label={direction === "prev" ? "Previous song" : "Next song"}
		>
			<svg
				width={size}
				height={size}
				viewBox="0 0 24 24"
				fill="none"
				stroke={color}
				strokeWidth="2"
			>
				{direction === "prev" ? (
					<>
						<path d="M6 6v12" />
						<path d="M18 6l-8 6 8 6V6z" fill={color} />
					</>
				) : (
					<>
						<path d="M6 6l8 6-8 6V6z" fill={color} />
						<path d="M18 6v12" />
					</>
				)}
			</svg>
		</button>
	);
}

export interface SongPreviewPanelProps {
	song: (typeof songs)[0];
	albumArtUrl: string;
	artistImageUrl: string | undefined;
	isLoading: boolean;
	theme: ThemeConfig;
	/** Navigation props for integrated media controls */
	onPrev: () => void;
	onNext: () => void;
}

export function SongPreviewPanel({
	song,
	albumArtUrl,
	artistImageUrl,
	isLoading,
	theme,
	onPrev,
	onNext,
}: SongPreviewPanelProps) {
	// Extract hue for light-mode vignette gradient
	const hue = extractHue(theme.primary);

	return (
		<div
			className="relative h-full w-full overflow-hidden"
			style={{ background: theme.bg }}
		>
			{/* Hero area - fixed height like SongDetailPanel */}
			<div
				className="relative"
				style={{ height: `${PANEL_LAYOUT.heroHeight}px` }}
			>
				{/* Artist image background - constrained to hero */}
				{artistImageUrl ? (
					<>
						<div
							className="absolute inset-0"
							style={{
								backgroundImage: `url(${artistImageUrl})`,
								backgroundSize: "cover",
								backgroundPosition: `center ${PANEL_LAYOUT.imagePositionY}%`,
							}}
						/>
						{/* Vignette overlay - light theme gradient */}
						<div
							className="absolute inset-0"
							style={{
								background: `linear-gradient(to bottom,
									hsla(${hue}, 25%, 88%, 0) 0%,
									hsla(${hue}, 25%, 88%, 0.1) 57%,
									hsla(${hue}, 25%, 88%, 0.8) 80%,
									hsla(${hue}, 25%, 88%, 1) 100%)`,
							}}
						/>
					</>
				) : (
					<div
						className="absolute inset-0"
						style={{ background: theme.surface }}
					/>
				)}

				{/* Top bar: Genre tag */}
				<div
					className="absolute top-4"
					style={{ left: `${PANEL_LAYOUT.paddingX}px` }}
				>
					<span
						className="px-2 py-1 text-[10px] tracking-[0.15em] uppercase"
						style={{
							fontFamily: fonts.body,
							color: theme.text,
							background: theme.surface,
						}}
					>
						{song.mood} · {song.tempo} BPM
					</span>
				</div>

				{/* Floating album art - positioned at bottom of hero */}
				<div
					className="absolute shadow-lg"
					style={{
						left: `${PANEL_LAYOUT.paddingX}px`,
						width: `${PANEL_LAYOUT.albumArtSize}px`,
						height: `${PANEL_LAYOUT.albumArtSize}px`,
						top: `${PANEL_LAYOUT.heroHeight - PANEL_LAYOUT.albumArtSize - 18}px`,
						transform: `translateY(${PANEL_LAYOUT.albumArtSize / 3}px)`,
						boxShadow: `0 4px 20px ${theme.primary}20`,
					}}
				>
					{isLoading ? (
						<div
							className="h-full w-full animate-pulse"
							style={{ background: theme.surface }}
						/>
					) : (
						<img
							src={albumArtUrl}
							alt={song.album}
							className="h-full w-full object-cover"
						/>
					)}
				</div>

				{/* Title + artist + controls: ⏮ Title ⏭ layout */}
				<div
					className="absolute"
					style={{
						left: `${PANEL_LAYOUT.paddingX + PANEL_LAYOUT.albumArtSize + 16}px`,
						right: `${PANEL_LAYOUT.paddingX}px`,
						top: `${PANEL_LAYOUT.heroHeight - PANEL_LAYOUT.albumArtSize - 18 + 6}px`,
						transform: `translateY(${PANEL_LAYOUT.albumArtSize / 3}px)`,
					}}
				>
					<div className="flex items-center gap-3">
						<NavButton
							direction="prev"
							onClick={onPrev}
							color={theme.text}
							size={18}
						/>
						<h3
							className="text-2xl leading-tight font-light"
							style={{ fontFamily: fonts.display, color: theme.text }}
						>
							{song.name}
						</h3>
						<NavButton
							direction="next"
							onClick={onNext}
							color={theme.text}
							size={18}
						/>
					</div>
					<p
						className="mt-0.5 text-sm"
						style={{ fontFamily: fonts.body, color: theme.text }}
					>
						{song.artist}
						<span style={{ color: theme.textMuted }}> · </span>
						{song.album}
					</p>
				</div>
			</div>

			{/* Content below hero */}
			<div
				className="px-5 pt-12 pb-8"
				style={{
					paddingLeft: `${PANEL_LAYOUT.paddingX}px`,
					paddingRight: `${PANEL_LAYOUT.paddingX}px`,
				}}
			>
				{/* Mood description */}
				{song.keyLines[0] && (
					<p
						className="max-w-md text-sm leading-relaxed italic"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						"{song.keyLines[0].meaning}"
					</p>
				)}

				{/* Themes with hover */}
				<div className="mt-8">
					<ThemesList themes={song.themes} theme={theme} />
				</div>
			</div>
		</div>
	);
}
