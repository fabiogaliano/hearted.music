/**
 * SongDetailPanel
 *
 * Production-ready slide-out panel for song details.
 * Unified dark/light theming via `isDark` prop (defaults to true).
 *
 * Architecture:
 * - Single component replaces V1Light/V2ThemedDark from SongDetailExplorer
 * - Collapse/expand animation with scroll interception and snap states
 * - Theme-derived colors maintain visual cohesion in both modes
 * - Keyboard shortcuts for navigation (j/k, arrows, escape)
 *
 * Design Philosophy (from DESIGN-GUIDANCE.md):
 * - Typography-first: Generous use of serif display fonts
 * - Minimal chrome: Let content and whitespace dominate
 * - Warm pastels: Monochromatic HSL-based colors
 * - High contrast: Clear text readability
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useShortcut } from "@/lib/keyboard/useShortcut";
import { fonts } from "@/lib/theme/fonts";
import { useThemeWithOverride } from "@/lib/theme/ThemeHueProvider";
import type { ThemeConfig } from "@/lib/theme/types";
import { extractHue } from "@/lib/utils/color";
import type { AnalysisContent, LikedSong } from "../types";
import { formatRelativeTime, isNewSong } from "../types";
import { AudioInfo } from "./detail/AudioInfo";
import { ContextSection } from "./detail/ContextSection";
import { MeaningSection } from "./detail/MeaningSection";
import { Nav } from "./detail/Nav";
import { PlaylistsSection } from "./detail/PlaylistsSection";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SongDetailPanelProps {
	/** Optional theme override - for dark mode or special cases */
	theme?: ThemeConfig;
	song: LikedSong;
	albumArtUrl?: string;
	artistImageUrl?: string;
	isExpanded: boolean;
	/** Starting rect for FLIP animation origin (null = no animation) */
	startRect: {
		top: number;
		left: number;
		width: number;
		height: number;
	} | null;
	onClose: () => void;
	onNext: () => void;
	onPrevious: () => void;
	hasNext: boolean;
	hasPrevious: boolean;
	/** Dark mode (default: true). Uses theme-derived dark colors when true. */
	isDark?: boolean;
}

// Mock playlists for matching (demo purposes)
const mockPlaylists = [
	{
		id: 1,
		name: "Late Night Feels",
		matchScore: 0.94,
		reason: "Moody and introspective — made for late night thoughts",
	},
	{
		id: 2,
		name: "Soul & Groove",
		matchScore: 0.89,
		reason: "The groove and warmth fit right in",
	},
	{
		id: 3,
		name: "Relationship Therapy",
		matchScore: 0.82,
		reason: "Emotionally resonant — perfect for processing",
	},
	{
		id: 4,
		name: "Morning Coffee",
		matchScore: 0.45,
		reason: "A bit too intense for easy mornings",
	},
];

// ─────────────────────────────────────────────────────────────────────────────
// Layout Configuration - Fixed values, no dynamic calculation needed
// ─────────────────────────────────────────────────────────────────────────────

const LAYOUT = {
	heroHeight: 450,
	collapsedHeaderHeight: 108,
	albumArtExpanded: 112,
	albumArtCollapsed: 56,
	imagePositionY: 30,
	paddingX: 20,
};

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function clamp01(value: number) {
	return Math.min(1, Math.max(0, value));
}

function lerp(from: number, to: number, t: number) {
	return from + (to - from) * t;
}

function smoothstep(t: number) {
	return t * t * (3 - 2 * t);
}

const useIsomorphicLayoutEffect =
	typeof window !== "undefined" ? useLayoutEffect : useEffect;

// ─────────────────────────────────────────────────────────────────────────────
// Theme-Derived Colors
// ─────────────────────────────────────────────────────────────────────────────

interface ThemedDarkColors {
	bg: string;
	bgLight: string;
	bgLighter: string;
	bgVignette: string;
	bgFade: string;
	surface: string;
	surfaceHover: string;
	border: string;
	borderLight: string;
	text: string;
	textMuted: string;
	textDim: string;
	accent: string;
	accentMuted: string;
	accentSubtle: string;
}

/**
 * Generate a themed dark palette based on the theme's primary hue.
 * Creates warm, saturated darks instead of pure blacks/grays.
 */
function getThemedDarkColors(theme: ThemeConfig): ThemedDarkColors {
	const hue = extractHue(theme.primary);

	return {
		bg: `hsl(${hue}, 18%, 8%)`,
		bgLight: `hsl(${hue}, 16%, 12%)`,
		bgLighter: `hsl(${hue}, 14%, 16%)`,
		bgVignette: `hsla(${hue}, 18%, 8%, 0.44)`,
		bgFade: `hsl(${hue}, 18%, 8%)`,
		surface: `hsl(${hue}, 14%, 14%)`,
		surfaceHover: `hsl(${hue}, 16%, 18%)`,
		border: `hsl(${hue}, 12%, 22%)`,
		borderLight: `hsl(${hue}, 10%, 28%)`,
		text: `hsl(${hue}, 12%, 94%)`,
		textMuted: `hsl(${hue}, 10%, 65%)`,
		textDim: `hsl(${hue}, 8%, 45%)`,
		accent: `hsl(${hue}, 50%, 65%)`,
		accentMuted: `hsl(${hue}, 35%, 50%)`,
		accentSubtle: `hsl(${hue}, 25%, 25%)`,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Analysis Sections Component
// ─────────────────────────────────────────────────────────────────────────────

interface AnalysisSectionsProps {
	analysis?: AnalysisContent;
	expandedSections: Set<string>;
	toggleSection: (section: string) => void;
	addedTo: number[];
	onAddToPlaylist: (id: number) => void;
	onClose: () => void;
}

function AnalysisSections({
	analysis,
	expandedSections,
	toggleSection,
	addedTo,
	onAddToPlaylist,
	onClose,
}: AnalysisSectionsProps) {
	if (!analysis) return null;

	return (
		<div className="space-y-10">
			{/* Themes + Journey */}
			{analysis.meaning?.themes && analysis.meaning.themes.length > 0 && (
				<MeaningSection
					emotional={undefined}
					themes={analysis.meaning?.themes}
					journey={analysis.emotional?.journey || []}
					isJourneyExpanded={expandedSections.has("journey")}
					onToggleJourney={() => toggleSection("journey")}
				/>
			)}

			{/* Context section (Perfect For) */}
			<ContextSection bestMoments={analysis.context?.best_moments} />

			{/* Playlists section */}
			<PlaylistsSection
				playlists={mockPlaylists}
				addedTo={addedTo}
				isOtherExpanded={expandedSections.has("other-playlists")}
				onAdd={onAddToPlaylist}
				onToggleOther={() => toggleSection("other-playlists")}
				onSkip={onClose}
				onMarkSorted={onClose}
			/>
		</div>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function SongDetailPanel({
	theme: themeOverride,
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	startRect,
	onClose,
	onNext,
	onPrevious,
	hasNext,
	hasPrevious,
	isDark = false,
}: SongDetailPanelProps) {
	const baseTheme = useThemeWithOverride(themeOverride);
	// Derive colors based on isDark prop
	const dark = isDark ? getThemedDarkColors(baseTheme) : null;
	const hue = extractHue(baseTheme.primary);

	// Color shortcuts for cleaner JSX
	const colors = {
		bg: isDark ? dark!.bg : baseTheme.bg,
		bgLight: isDark ? dark!.bgLight : baseTheme.surface,
		text: isDark ? dark!.text : baseTheme.text,
		textMuted: isDark ? dark!.textMuted : baseTheme.textMuted,
		textDim: isDark ? dark!.textDim : baseTheme.textMuted,
		// Separator color: textDim for dark, border for light (matches original variations)
		separator: isDark ? dark!.textDim : baseTheme.border,
		border: isDark ? dark!.border : baseTheme.border,
		accent: isDark ? dark!.accent : baseTheme.primary,
	};

	// State for analysis sections
	const [expandedSections, setExpandedSections] = useState<Set<string>>(
		new Set(),
	);
	const [addedTo, setAddedTo] = useState<number[]>([]);

	const analysis = song.analysis?.analysis as AnalysisContent | undefined;
	const isNew = isNewSong(song.liked_at);

	// ─────────────────────────────────────────────────────────────────────────
	// Keyboard Shortcuts
	// ─────────────────────────────────────────────────────────────────────────

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

	// ─────────────────────────────────────────────────────────────────────────
	// Handlers
	// ─────────────────────────────────────────────────────────────────────────

	const toggleSection = (section: string) => {
		setExpandedSections((prev) => {
			const next = new Set(prev);
			if (next.has(section)) {
				next.delete(section);
			} else {
				next.add(section);
			}
			return next;
		});
	};

	const handleAddToPlaylist = (playlistId: number) => {
		if (!addedTo.includes(playlistId)) {
			setAddedTo([...addedTo, playlistId]);
		}
	};

	// ─────────────────────────────────────────────────────────────────────────
	// Collapse/Expand Animation
	// ─────────────────────────────────────────────────────────────────────────

	const scrollRef = useRef<HTMLDivElement | null>(null);
	const headerRef = useRef<HTMLDivElement | null>(null);
	const heroRef = useRef<HTMLDivElement | null>(null);
	const artistImageRef = useRef<HTMLDivElement | null>(null);
	const vignetteRef = useRef<HTMLDivElement | null>(null);
	const bottomFadeRef = useRef<HTMLDivElement | null>(null);
	const genreRef = useRef<HTMLDivElement | null>(null);
	const albumArtRef = useRef<HTMLDivElement | null>(null);
	const textBlockRef = useRef<HTMLDivElement | null>(null);
	const titleRef = useRef<HTMLDivElement | null>(null);
	const metaRef = useRef<HTMLDivElement | null>(null);
	const contentRef = useRef<HTMLDivElement | null>(null);
	const rafIdRef = useRef<number | null>(null);
	const lastProgressRef = useRef<number | null>(null);
	const snapStateRef = useRef<0 | 1 | null>(null);
	const collapseOffsetRef = useRef(0);
	const [reduceMotion, setReduceMotion] = useState(false);
	// Track the current song to reset collapse state on song change
	const currentSongIdRef = useRef<string | null>(null);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const media = window.matchMedia("(prefers-reduced-motion: reduce)");
		setReduceMotion(media.matches);
		const handler = () => setReduceMotion(media.matches);
		media.addEventListener("change", handler);
		return () => media.removeEventListener("change", handler);
	}, []);

	// Reset collapse state when DISPLAYED song changes (after transition completes)
	// Using song instead of song prevents scroll jump during transition animation
	useEffect(() => {
		if (song.track.id !== currentSongIdRef.current) {
			currentSongIdRef.current = song.track.id;
			// Reset to fully expanded state
			collapseOffsetRef.current = 0;
			snapStateRef.current = 0;
			lastProgressRef.current = null;
			// Reset scroll position
			if (scrollRef.current) {
				scrollRef.current.scrollTop = 0;
			}
			// Apply the expanded state immediately
			applyProgress(0);
		}
	}, [song.track.id]);

	const applyProgress = (progress: number) => {
		if (
			lastProgressRef.current != null &&
			Math.abs(lastProgressRef.current - progress) < 0.001
		)
			return;
		lastProgressRef.current = progress;

		// All values are now fixed - no dynamic calculation needed
		const {
			heroHeight: expandedHeroHeight,
			collapsedHeaderHeight,
			albumArtExpanded,
			albumArtCollapsed,
			paddingX,
		} = LAYOUT;

		const heroHeight = lerp(
			expandedHeroHeight,
			collapsedHeaderHeight,
			progress,
		);
		const imageOpacity = 1 - progress;
		const borderOpacity = progress;

		const artSize = lerp(albumArtExpanded, albumArtCollapsed, progress);
		const artTopExpanded = expandedHeroHeight - albumArtExpanded - 18;
		const artTopCollapsed = (collapsedHeaderHeight - albumArtCollapsed) / 2;
		const artTop = lerp(artTopExpanded, artTopCollapsed, progress);
		const artTranslateY = lerp(albumArtExpanded / 3, 0, progress);

		const contentTopPadding = Math.max(
			16,
			heroHeight - collapsedHeaderHeight + 16,
		);

		// Always reserve space for album art (prevents text jumping while art loads async)
		const textLeft = paddingX + artSize + 16;
		const textTopExpanded = artTopExpanded + 6;
		const textTopCollapsed = Math.max(0, (collapsedHeaderHeight - 44) / 2);
		const textTop = lerp(textTopExpanded, textTopCollapsed, progress);
		const titleSize = lerp(24, 16, progress);
		const metaSize = lerp(14, 12, progress);

		if (headerRef.current) {
			headerRef.current.style.borderBottomColor = `${colors.border}${Math.round(
				borderOpacity * 255,
			)
				.toString(16)
				.padStart(2, "0")}`;
		}
		if (heroRef.current) heroRef.current.style.height = `${heroHeight}px`;
		if (artistImageRef.current)
			artistImageRef.current.style.opacity = `${imageOpacity}`;
		if (vignetteRef.current)
			vignetteRef.current.style.opacity = `${imageOpacity}`;
		if (genreRef.current) genreRef.current.style.opacity = `${imageOpacity}`;
		// Bottom fade becomes visible during collapse to mask the hard clip edge
		const bottomFadeOpacity = smoothstep(clamp01(progress * 2));
		if (bottomFadeRef.current)
			bottomFadeRef.current.style.opacity = `${bottomFadeOpacity}`;

		if (albumArtRef.current) {
			albumArtRef.current.style.left = `${paddingX}px`;
			albumArtRef.current.style.width = `${artSize}px`;
			albumArtRef.current.style.height = `${artSize}px`;
			albumArtRef.current.style.top = `${artTop}px`;
			albumArtRef.current.style.transform = `translateY(${artTranslateY}px)`;
			// Opacity depends on whether we have an actual URL
			albumArtRef.current.style.opacity = albumArtUrl ? "1" : "0";
		}

		if (textBlockRef.current) {
			textBlockRef.current.style.left = `${textLeft}px`;
			textBlockRef.current.style.top = `${textTop}px`;
			textBlockRef.current.style.right = `${paddingX}px`;
			textBlockRef.current.style.transform = `translateY(${artTranslateY}px)`;
		}
		if (titleRef.current) titleRef.current.style.fontSize = `${titleSize}px`;
		if (metaRef.current) metaRef.current.style.fontSize = `${metaSize}px`;
		if (genreRef.current) genreRef.current.style.left = `${paddingX}px`;
		if (contentRef.current) {
			contentRef.current.style.paddingTop = `${contentTopPadding}px`;
			contentRef.current.style.paddingLeft = `${paddingX}px`;
			contentRef.current.style.paddingRight = `${paddingX}px`;
		}
	};

	const getCollapseMetrics = () => {
		// Fixed values - no dynamic calculation
		const { heroHeight, collapsedHeaderHeight } = LAYOUT;
		const collapseDistance = heroHeight - collapsedHeaderHeight; // 450 - 108 = 342
		return {
			expandedHeroHeight: heroHeight,
			collapsedHeaderHeight,
			collapseDistance,
		};
	};

	const applyFromCollapseOffset = () => {
		const { collapseDistance } = getCollapseMetrics();
		const raw = clamp01(
			collapseOffsetRef.current / Math.max(1, collapseDistance),
		);
		if (reduceMotion) {
			applyProgress(smoothstep(raw > 0 ? 1 : 0));
			return collapseDistance;
		}

		let stepped = raw;
		if (snapStateRef.current === 1) {
			if (stepped < 0.85) snapStateRef.current = null;
			else stepped = 1;
		} else if (snapStateRef.current === 0) {
			if (stepped > 0.15) snapStateRef.current = null;
			else stepped = 0;
		} else {
			if (stepped > 0.96) {
				snapStateRef.current = 1;
				stepped = 1;
			} else if (stepped < 0.02) {
				snapStateRef.current = 0;
				stepped = 0;
			}
		}
		applyProgress(smoothstep(stepped));
		return collapseDistance;
	};

	useIsomorphicLayoutEffect(() => {
		const el = scrollRef.current;
		if (!el) return;

		// With fixed LAYOUT values, we don't need dynamic dimension tracking anymore
		// Just sync collapse state if user scrolled
		const { collapseDistance } = getCollapseMetrics();
		if (el.scrollTop > 0) {
			collapseOffsetRef.current = collapseDistance;
			snapStateRef.current = 1;
		}
		applyFromCollapseOffset();

		const wheelHandler = (e: WheelEvent) => {
			const deltaY = e.deltaY;
			if (!deltaY) return;

			const { collapseDistance } = getCollapseMetrics();
			const atTop = el.scrollTop <= 0;
			const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;

			if (el.scrollTop > 0 && collapseOffsetRef.current < collapseDistance) {
				collapseOffsetRef.current = collapseDistance;
				snapStateRef.current = 1;
				applyFromCollapseOffset();
			}

			if (deltaY > 0) {
				if (collapseOffsetRef.current < collapseDistance) {
					e.preventDefault();
					const start = collapseOffsetRef.current;
					const next = reduceMotion ? collapseDistance : start + deltaY;
					if (next >= collapseDistance) {
						const leftover = next - collapseDistance;
						collapseOffsetRef.current = collapseDistance;
						snapStateRef.current = 1;
						applyFromCollapseOffset();
						if (leftover > 0) {
							const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
							el.scrollTop = Math.min(maxScroll, el.scrollTop + leftover);
						}
					} else {
						collapseOffsetRef.current = next;
						snapStateRef.current = null;
						applyFromCollapseOffset();
					}
					return;
				}

				if (atBottom) e.preventDefault();
				return;
			}

			if (deltaY < 0) {
				if (atTop) {
					e.preventDefault();
					if (collapseOffsetRef.current > 0) {
						const start = collapseOffsetRef.current;
						const next = reduceMotion ? 0 : start + deltaY;
						if (next <= 0) {
							collapseOffsetRef.current = 0;
							snapStateRef.current = 0;
							applyFromCollapseOffset();
						} else {
							collapseOffsetRef.current = next;
							snapStateRef.current = null;
							applyFromCollapseOffset();
						}
					}
					return;
				}
				return;
			}
		};

		el.addEventListener("wheel", wheelHandler, { passive: false });
		return () => {
			el.removeEventListener("wheel", wheelHandler);
		};
	}, [isExpanded, albumArtUrl, reduceMotion]);

	useEffect(() => {
		return () => {
			if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
		};
	}, []);

	const onScroll = () => {
		const el = scrollRef.current;
		if (!el) return;
		if (rafIdRef.current != null) return;

		rafIdRef.current = requestAnimationFrame(() => {
			rafIdRef.current = null;
			if (el.scrollTop > 0) {
				const { collapseDistance } = getCollapseMetrics();
				if (collapseOffsetRef.current < collapseDistance) {
					collapseOffsetRef.current = collapseDistance;
					snapStateRef.current = 1;
					applyFromCollapseOffset();
				}
			}
		});
	};

	// ─────────────────────────────────────────────────────────────────────────
	// Render
	// ─────────────────────────────────────────────────────────────────────────

	if (!startRect) return null;

	// Vignette gradient based on mode
	const vignetteGradient = isDark
		? `radial-gradient(ellipse at center, transparent 20%, ${dark!.bgVignette} 100%),
		   linear-gradient(to bottom, transparent 40%, ${dark!.bgFade} 100%)`
		: `linear-gradient(to bottom,
			hsla(${hue}, 25%, 88%, 0) 0%,
			hsla(${hue}, 25%, 88%, 0.1) 57%,
			hsla(${hue}, 25%, 88%, 0.8) 80%,
			hsla(${hue}, 25%, 88%, 1) 100%)`;

	// CSS-based responsive sizing
	// Layout: Sidebar is 256px (w-64), main content has px-12 (48px each side)
	//
	// Breakpoints:
	// - Large (1400px+): 45vw panel, plenty of room for list
	// - Medium (1000-1400px): 500-600px panel, list compresses
	// - Small (<1000px): Panel takes full width minus sidebar (list hidden under panel)
	//
	// Using CSS clamp() for smooth responsive scaling without JS resize listeners

	return (
		<div
			className="z-50 overflow-hidden"
			style={{
				position: "fixed",
				borderLeft: isDark ? "none" : `1px solid ${baseTheme.border}`,
				// Slide in from right, GPU-accelerated
				transition:
					"transform 0.35s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.3s ease-out",
				top: 0,
				right: 0,
				// Responsive width: min 380px, preferred 45%, max full-width minus sidebar
				width: "clamp(380px, 45vw, calc(100vw - 280px))",
				height: "100vh",
				// Slide in from right edge
				transform: isExpanded ? "translateX(0)" : "translateX(100%)",
				opacity: isExpanded ? 1 : 0,
				pointerEvents: isExpanded ? "auto" : "none",
			}}
		>
			<div className="h-full" style={{ background: colors.bg }}>
				<div
					ref={scrollRef}
					onScroll={onScroll}
					className="h-full overflow-y-auto"
					style={{ overscrollBehaviorY: "contain" }}
				>
					<div
						ref={headerRef}
						className="sticky top-0 z-20"
						style={{
							background: colors.bg,
							borderBottom: `1px solid transparent`,
							height: "108px",
							overflow: "visible",
							willChange: "border-bottom-color",
						}}
					>
						<div className="relative h-full">
							<div
								ref={heroRef}
								className="absolute inset-x-0 top-0"
								style={{
									height: `${LAYOUT.heroHeight}px`,
									pointerEvents: "none",
									transition: "height 0.1s ease-out",
									willChange: "height",
								}}
							>
								{/* Artist image background */}
								{artistImageUrl ? (
									<>
										<div
											ref={artistImageRef}
											className="absolute inset-0"
											style={{
												backgroundImage: `url(${artistImageUrl})`,
												backgroundSize: "cover",
												backgroundPosition: `center ${LAYOUT.imagePositionY}%`,
												transition: "opacity 0.12s ease-out",
												willChange: "opacity",
											}}
										/>
										{/* Vignette overlay */}
										<div
											ref={vignetteRef}
											className="absolute inset-0"
											style={{
												background: vignetteGradient,
												transition: "opacity 0.12s ease-out",
												willChange: "opacity",
											}}
										/>
									</>
								) : (
									<div
										ref={artistImageRef}
										className="absolute inset-0"
										style={{ background: colors.bgLight }}
									/>
								)}

								{/* Bottom fade - masks the hard clip edge during scroll collapse */}
								{/* This element becomes visible as collapse progresses, independent of image opacity */}
								<div
									ref={bottomFadeRef}
									className="pointer-events-none absolute inset-x-0 bottom-0"
									style={{
										height: "50%",
										background: `linear-gradient(to bottom, transparent 0%, ${colors.bg} 100%)`,
										opacity: 0,
										transition: "opacity 0.12s ease-out",
										willChange: "opacity",
									}}
								/>

								{/* Genre top left */}
								{analysis?.musical_style?.genre_primary && isExpanded && (
									<div
										ref={genreRef}
										className="absolute top-3 left-5"
										style={{ left: "20px" }}
									>
										<span
											className="text-[10px] tracking-[0.15em] uppercase"
											style={{
												fontFamily: fonts.body,
												color: colors.textMuted,
											}}
										>
											{analysis.musical_style.genre_primary}
										</span>
									</div>
								)}

								{/* Floating album art */}
								{albumArtUrl && isExpanded && (
									<div
										ref={albumArtRef}
										className={`absolute left-5 ${isDark ? "shadow-2xl" : "shadow-lg"}`}
										style={{
											left: `${LAYOUT.paddingX}px`,
											width: `${LAYOUT.albumArtExpanded}px`,
											height: `${LAYOUT.albumArtExpanded}px`,
											top: `${LAYOUT.heroHeight - LAYOUT.albumArtExpanded - 18}px`,
											transform: `translateY(${LAYOUT.albumArtExpanded / 3}px)`,
											boxShadow: isDark
												? `0 8px 32px ${colors.bg}`
												: `0 4px 20px ${baseTheme.primary}20`,
											transition:
												"transform 0.1s ease-out, top 0.1s ease-out, width 0.1s ease-out, height 0.1s ease-out, opacity 0.1s ease-out",
											willChange:
												"transform, top, left, width, height, opacity",
											viewTransitionName: isExpanded ? "song-album" : "none",
										}}
									>
										<img
											src={albumArtUrl}
											alt=""
											className="h-full w-full object-cover"
										/>
									</div>
								)}

								<div
									ref={textBlockRef}
									className="absolute"
									style={{
										right: `${LAYOUT.paddingX}px`,
										// Always reserve space for album art when expanded (even while loading)
										// This prevents text from jumping when albumArtUrl loads async
										left: `${LAYOUT.paddingX + LAYOUT.albumArtExpanded + 16}px`,
										top: `${LAYOUT.heroHeight - LAYOUT.albumArtExpanded - 18 + 6}px`,
										transform: `translateY(${LAYOUT.albumArtExpanded / 3}px)`,
										transition:
											"transform 0.1s ease-out, top 0.1s ease-out, left 0.1s ease-out",
										willChange: "transform, top, left, right",
									}}
								>
									{/* Title */}
									<div
										ref={titleRef}
										className="leading-tight font-light"
										style={{
											fontFamily: fonts.display,
											fontSize: "24px",
											color: colors.text,
											transition: "font-size 0.1s ease-out",
											// View Transition: panel has the name when expanded
											viewTransitionName: isExpanded ? "song-title" : "none",
										}}
									>
										{song.track.name}
									</div>

									{/* Artist */}
									<div
										ref={metaRef}
										className="mt-0.5"
										style={{
											fontFamily: fonts.body,
											fontSize: "14px",
											color: colors.text,
											transition: "font-size 0.1s ease-out",
											// View Transition: panel has the name when expanded
											viewTransitionName: isExpanded ? "song-artist" : "none",
										}}
									>
										{song.track.artist}
										<span style={{ color: colors.separator }}> · </span>
										{song.track.album}
									</div>
								</div>
							</div>

							{/* Nav */}
							<div
								className={`absolute top-3 right-3 transition-opacity duration-300 ${isExpanded ? "opacity-100" : "opacity-0"}`}
							>
								<Nav
									onClose={onClose}
									onNext={onNext}
									onPrevious={onPrevious}
									hasNext={hasNext}
									hasPrevious={hasPrevious}
									isDark={isDark}
								/>
							</div>
						</div>
					</div>

					{/* Content container - imperatively managed by collapse animation */}
					<div
						ref={contentRef}
						className="pb-4"
						style={{
							paddingTop: "56px",
							paddingLeft: "20px",
							paddingRight: "20px",
						}}
					>
						{/* Album + meta */}
						<div
							className="mb-4 flex items-center gap-2 text-xs"
							style={{ fontFamily: fonts.body, color: colors.textDim }}
						>
							<span>Liked {formatRelativeTime(song.liked_at)}</span>
							{isNew && (
								<>
									<span>·</span>
									<span
										className="text-[9px] tracking-widest uppercase"
										style={{ color: colors.accent }}
									>
										New
									</span>
								</>
							)}
						</div>

						{/* Audio info */}
						<div className="mb-4">
							<AudioInfo
								audioFeatures={analysis?.audio_features}
								isDark={isDark}
							/>
						</div>

						{/* Mood */}
						{analysis?.emotional?.mood_description && (
							<p
								className="text-sm leading-relaxed italic"
								style={{ fontFamily: fonts.body, color: colors.textMuted }}
							>
								"{analysis.emotional.mood_description}"
							</p>
						)}

						{/* Full analysis sections */}
						<div className="mt-8">
							<AnalysisSections
								analysis={analysis}
								expandedSections={expandedSections}
								toggleSection={toggleSection}
								addedTo={addedTo}
								onAddToPlaylist={handleAddToPlaylist}
								onClose={onClose}
							/>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export default SongDetailPanel;
