/**
 * SongDetailPanelNew
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
import { HorizontalJourney } from "./detail/HorizontalJourney";
import { KeyLinesSection } from "./detail/KeyLinesSection";
import { Nav } from "./detail/Nav";
import { PlaylistsSection } from "./detail/PlaylistsSection";
import type { ColorProps } from "./detail/types";

const PANEL_KEYFRAMES = `
@keyframes hearted-slide-fwd {
	from { opacity: 0; transform: translateX(12px); }
	to { opacity: 1; transform: translateX(0); }
}
@keyframes hearted-slide-back {
	from { opacity: 0; transform: translateX(-12px); }
	to { opacity: 1; transform: translateX(0); }
}
@keyframes hearted-fade {
	from { opacity: 0; }
	to { opacity: 1; }
}
@keyframes hearted-push-up {
	from { opacity: 0; transform: translateY(14px); }
	to { opacity: 1; transform: translateY(0); }
}
@keyframes hearted-push-down {
	from { opacity: 0; transform: translateY(-14px); }
	to { opacity: 1; transform: translateY(0); }
}
@keyframes hearted-tick-pulse {
	from { transform: scaleY(0.68); }
	to { transform: scaleY(1); }
}
`;

function balancedLines(text: string) {
	const mid = Math.floor(text.length / 2);
	const spaceAfter = text.indexOf(" ", mid);
	const spaceBefore = text.lastIndexOf(" ", mid);
	const breakAt =
		spaceAfter !== -1 && spaceAfter - mid <= mid - spaceBefore
			? spaceAfter
			: spaceBefore;
	if (breakAt <= 0) return text;
	return (
		<>
			{text.slice(0, breakAt)}
			<br />
			{text.slice(breakAt + 1)}
		</>
	);
}

function SonicNumbers({
	audioFeatures,
	colorProps,
}: {
	audioFeatures: SonicVariantProps["audioFeatures"];
	colorProps: ColorProps;
}) {
	const { bpm, energy, valence } = deriveAudioLabels(audioFeatures);
	const columns = [
		bpm ? { value: String(bpm), label: "bpm" } : null,
		energy ? { value: energy.replace(" Energy", ""), label: "energy" } : null,
		valence ? { value: valence, label: "valence" } : null,
	].filter(Boolean) as { value: string; label: string }[];

	if (columns.length === 0) return null;

	return (
		<div style={{ display: "flex", gap: 20, flexShrink: 0 }}>
			{columns.map(({ value, label }) => (
				<div
					key={label}
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 2,
						alignItems: "flex-end",
					}}
				>
					<span
						style={{
							fontFamily: fonts.display,
							fontSize: 22,
							fontWeight: 400,
							lineHeight: 1,
							color: colorProps.text,
						}}
					>
						{value}
					</span>
					<span
						style={{
							fontFamily: fonts.body,
							fontSize: 7,
							letterSpacing: "0.12em",
							textTransform: "uppercase",
							color: colorProps.textDim,
						}}
					>
						{label}
					</span>
				</div>
			))}
		</div>
	);
}

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

/**
 * Spring interpolation for organic motion.
 * Attempt critically-damped spring (tension: 170, friction: 26).
 * Creates natural deceleration that feels like physical mass settling.
 */
function springInterpolate(t: number): number {
	const omega = 13.04; // sqrt(170) - natural frequency
	const time = t * 0.6; // scale factor for desired duration
	const decay = Math.exp(-omega * time);
	return clamp01(1 - decay * (1 + omega * time));
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
	const satMatch = theme.primary.match(/,\s*([\d.]+)%/);
	const primarySat = satMatch ? parseFloat(satMatch[1]) : 15;

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
		accent: `hsl(${hue}, ${primarySat}%, 72%)`,
		accentMuted: `hsl(${hue}, ${primarySat}%, 54%)`,
		accentSubtle: `hsl(${hue}, ${Math.max(8, primarySat - 4)}%, 26%)`,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal Components
// ─────────────────────────────────────────────────────────────────────────────

function AnalysisToggle({
	headline,
	interpretation,
	colorProps,
	isOpen,
	onToggle,
}: {
	headline: string;
	interpretation: string;
	colorProps: ColorProps;
	isOpen: boolean;
	onToggle: () => void;
}) {
	const [animKey, setAnimKey] = useState(0);
	const [hovered, setHovered] = useState(false);

	const toggle = () => {
		onToggle();
		setAnimKey((k) => k + 1);
	};

	return (
		<div
			onClick={toggle}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			className="cursor-pointer select-none"
			style={{ position: "relative" }}
		>
			<div
				key={animKey}
				style={{ animation: "hearted-fade 250ms ease forwards" }}
			>
				{isOpen ? (
					<p
						style={{
							fontFamily: fonts.body,
							fontSize: 16,
							lineHeight: 1.55,
							color: colorProps.textMuted,
							borderLeft: `2px solid ${colorProps.accent}`,
							paddingLeft: 12,
							fontStyle: "italic",
						}}
					>
						{interpretation}
					</p>
				) : (
					<p
						style={{
							fontFamily: fonts.display,
							fontSize: 26,
							fontWeight: 400,
							lineHeight: 1.35,
							color: hovered ? colorProps.accent : colorProps.text,
							transition: "color 200ms ease",
						}}
					>
						{headline}
					</p>
				)}
			</div>
			<span
				style={{
					fontFamily: fonts.body,
					fontSize: 10,
					letterSpacing: "0.04em",
					color: colorProps.textDim,
					opacity: hovered ? 1 : 0,
					position: "absolute",
					top: "100%",
					right: 0,
					marginTop: 8,
					pointerEvents: "none",
					transition: "opacity 200ms ease, color 200ms ease",
				}}
			>
				{isOpen ? "← back" : "read deeper →"}
			</span>
		</div>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sonic Row — 5 Variants
// ─────────────────────────────────────────────────────────────────────────────

interface SonicVariantProps {
	genres: string[];
	audioFeatures: {
		tempo: number | null;
		energy: number | null;
		valence: number | null;
	} | null;
	colorProps: ColorProps;
}

function deriveAudioLabels(af: SonicVariantProps["audioFeatures"]) {
	const bpm = af?.tempo ? Math.round(af.tempo) : null;
	const energy =
		af?.energy != null
			? af.energy > 0.66
				? "High Energy"
				: af.energy > 0.33
					? "Mid Energy"
					: "Low Energy"
			: null;
	const valence =
		af?.valence != null
			? af.valence > 0.66
				? "Bright"
				: af.valence > 0.33
					? "Neutral"
					: "Dark"
			: null;
	return { bpm, energy, valence };
}

/**
 * Numbers — BPM, energy, and valence as large display figures.
 * Genre pills below. Instrument Serif for the number, Geist for labels.
 * Genre pills — display only, no interaction.
 */
function SonicVariantNumbers({
	genres,
	colorProps,
}: Omit<SonicVariantProps, "audioFeatures">) {
	const [primaryGenre, ...altGenres] = genres;

	return (
		<div style={{ display: "flex", flexWrap: "wrap", gap: "4px 6px" }}>
			<span
				style={{
					fontFamily: fonts.body,
					fontSize: 8,
					letterSpacing: "0.07em",
					padding: "2px 8px",
					border: `0.5px solid ${colorProps.accent}`,
					borderRadius: 12,
					color: colorProps.accent,
				}}
			>
				{primaryGenre ?? "—"}
			</span>
			{altGenres.map((g) => (
				<span
					key={g}
					style={{
						fontFamily: fonts.body,
						fontSize: 8,
						letterSpacing: "0.06em",
						padding: "2px 8px",
						border: `0.5px solid ${colorProps.border}`,
						borderRadius: 12,
						color: colorProps.textDim,
					}}
				>
					{g}
				</span>
			))}
		</div>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function SongDetailPanelNew({
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
		surface: isDark ? dark!.surface : baseTheme.surface,
		surfaceHover: isDark ? dark!.surfaceHover : baseTheme.surfaceDim,
		text: isDark ? dark!.text : baseTheme.text,
		textMuted: isDark ? dark!.textMuted : baseTheme.textMuted,
		textDim: isDark ? dark!.textDim : baseTheme.textMuted,
		separator: isDark ? dark!.textDim : baseTheme.border,
		border: isDark ? dark!.border : baseTheme.border,
		accent: isDark ? dark!.accent : baseTheme.primary,
		accentMuted: isDark ? dark!.accentMuted : baseTheme.primaryHover,
	};

	// State for analysis sections
	const [expandedSections, setExpandedSections] = useState<Set<string>>(
		new Set(),
	);
	const [addedTo, setAddedTo] = useState<number[]>([]);

	const analysis = song.analysis?.analysis as AnalysisContent | undefined;

	const colorProps: ColorProps = {
		text: colors.text,
		textMuted: colors.textMuted,
		textDim: colors.textDim,
		accent: colors.accent,
		accentMuted: colors.accentMuted,
		border: colors.border,
		surface: colors.surface,
		surfaceHover: colors.surfaceHover,
		bg: colors.bg,
	};

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
	const spacerRef = useRef<HTMLDivElement | null>(null);
	const lastProgressRef = useRef<number | null>(null);
	const snapStateRef = useRef<0 | 1 | null>(null);
	const collapseOffsetRef = useRef(0);
	const reducedMotionTweenRef = useRef<number | null>(null);
	const [reduceMotion, setReduceMotion] = useState(false);
	// Track the current song to reset collapse state on song change
	const currentSongIdRef = useRef<string | null>(null);

	// Animation refs for content stagger and crossfade
	const staggerRefs = useRef<(HTMLDivElement | null)[]>([]);
	const staggerAnimationRef = useRef<number | null>(null);
	const contentWrapperRef = useRef<HTMLDivElement | null>(null);
	const crossfadeRafRef = useRef<number | null>(null);
	const analysisRef = useRef<HTMLDivElement | null>(null);
	const analysisRafRef = useRef<number | null>(null);
	const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);
	const sonicTextureRef = useRef<HTMLParagraphElement | null>(null);
	const [sonicTextureSingleLine, setSonicTextureSingleLine] = useState(false);

	// Animation timing constants
	const STAGGER_DELAY = 60; // ms between sections
	const STAGGER_DURATION = 250; // ms per section fade
	const CROSSFADE_DURATION = 180; // ms total for song navigation crossfade
	const PARALLAX_RATIO = 0.4; // artist image moves at 40% of scroll speed
	const CLUSTER_TO_CONTENT_GAP = 10; // visual gap from floating header cluster to content

	useEffect(() => {
		if (typeof window === "undefined") return;
		const media = window.matchMedia("(prefers-reduced-motion: reduce)");
		setReduceMotion(media.matches);
		const handler = () => setReduceMotion(media.matches);
		media.addEventListener("change", handler);
		return () => media.removeEventListener("change", handler);
	}, []);

	useEffect(() => {
		const el = sonicTextureRef.current;
		if (!el || !isAnalysisOpen || !analysis?.sonic_texture) {
			setSonicTextureSingleLine(false);
			return;
		}
		const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 14;
		setSonicTextureSingleLine(el.scrollHeight <= lineHeight * 1.2);
	}, [isAnalysisOpen, analysis?.sonic_texture]);

	useEffect(() => {
		const id = "hearted-panel-keyframes";
		if (!document.getElementById(id)) {
			const style = document.createElement("style");
			style.id = id;
			style.textContent = PANEL_KEYFRAMES;
			document.head.appendChild(style);
		}
	}, []);

	// Reset Phase 2 to collapsed state (used on panel open and song navigation)
	const closeAnalysis = () => {
		setIsAnalysisOpen(false);
		if (analysisRef.current && analysis?.headline) {
			analysisRef.current.style.maxHeight = "0";
			analysisRef.current.style.overflow = "hidden";
		}
	};

	// Trigger stagger animation when panel expands
	useEffect(() => {
		if (isExpanded) {
			closeAnalysis();
			const indices = analysis?.headline ? [0, 1, 2] : undefined;
			const id = setTimeout(() => animateStaggerIn(indices), 80);
			return () => clearTimeout(id);
		}
	}, [isExpanded]);

	// Reset collapse state when DISPLAYED song changes (after transition completes)
	// Using song instead of song prevents scroll jump during transition animation
	useEffect(() => {
		if (song.track.id !== currentSongIdRef.current) {
			const hadPrevious = currentSongIdRef.current !== null;

			if (hadPrevious && isExpanded) {
				// Crossfade to new song with smooth transition
				animateCrossfade(() => {
					currentSongIdRef.current = song.track.id;
					lastProgressRef.current = null;
					if (scrollRef.current) {
						scrollRef.current.scrollTop = 0;
					}

					const shouldKeepAnalysis = isAnalysisOpen && analysis?.headline;

					if (shouldKeepAnalysis) {
						const { collapseDistance } = getCollapseMetrics();
						collapseOffsetRef.current = collapseDistance;
						snapStateRef.current = 1;
						applyProgress(1);
						if (analysisRef.current) {
							analysisRef.current.style.maxHeight = "none";
							analysisRef.current.style.overflow = "visible";
						}
						const playlistsEl = staggerRefs.current[2];
						if (playlistsEl) playlistsEl.style.opacity = "0";
						for (const i of [0, 1, 3, 4, 5]) {
							const el = staggerRefs.current[i];
							if (el) {
								el.style.opacity = "1";
								el.style.transform = "translateY(0)";
							}
						}
					} else {
						collapseOffsetRef.current = 0;
						snapStateRef.current = 0;
						applyProgress(0);
						closeAnalysis();
						// Set elements visible immediately — crossfade handles the transition
						const visibleIndices = analysis?.headline ? [0, 1, 2] : [0];
						for (const idx of visibleIndices) {
							const el = staggerRefs.current[idx];
							if (el) {
								el.style.opacity = "1";
								el.style.transform = "translateY(0)";
							}
						}
					}
				});
			} else {
				// First open - no crossfade needed
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
		}
	}, [song.track.id, isExpanded]);

	// Toggle willChange to optimize GPU memory (only promote layers during animation)
	const setWillChange = (active: boolean) => {
		const value = active ? "transform, opacity" : "auto";
		const sizeValue = active
			? "transform, top, width, height, opacity"
			: "auto";
		const fontValue = active ? "font-size" : "auto";

		if (heroRef.current)
			heroRef.current.style.willChange = active ? "height" : "auto";
		// Artist image needs transform for parallax effect
		if (artistImageRef.current)
			artistImageRef.current.style.willChange = active
				? "transform, opacity"
				: "auto";
		if (vignetteRef.current) vignetteRef.current.style.willChange = value;
		if (bottomFadeRef.current) bottomFadeRef.current.style.willChange = value;
		if (albumArtRef.current) albumArtRef.current.style.willChange = sizeValue;
		if (textBlockRef.current) textBlockRef.current.style.willChange = value;
		if (titleRef.current) titleRef.current.style.willChange = fontValue;
		if (metaRef.current) metaRef.current.style.willChange = fontValue;
	};

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

		// Always reserve space for album art (prevents text jumping while art loads async)
		const textLeft = paddingX + artSize + 16;
		const textTopExpanded = artTopExpanded;
		const textTopCollapsed = artTopCollapsed;
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
		// Parallax: artist image moves slower during scroll collapse
		const parallaxOffset =
			progress * (expandedHeroHeight - collapsedHeaderHeight) * PARALLAX_RATIO;
		if (artistImageRef.current) {
			artistImageRef.current.style.opacity = `${imageOpacity}`;
			artistImageRef.current.style.transform = `translateY(-${parallaxOffset}px)`;
		}
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
			textBlockRef.current.style.height = `${artSize}px`;
			textBlockRef.current.style.transform = `translateY(${artTranslateY}px)`;
		}
		if (titleRef.current) titleRef.current.style.fontSize = `${titleSize}px`;
		if (metaRef.current) metaRef.current.style.fontSize = `${metaSize}px`;
		if (genreRef.current) genreRef.current.style.left = `${paddingX}px`;
		if (headerRef.current) {
			const headerRect = headerRef.current.getBoundingClientRect();
			const headerBottom = headerRect.bottom;
			const textBottom =
				textBlockRef.current?.getBoundingClientRect().bottom ?? headerBottom;
			// When albumArtUrl exists but div hasn't mounted yet (loads async), derive the expected
			// art bottom from layout constants so the spacer reserves the right amount of space.
			// Mirrors the textBlockRef horizontal reservation at line ~1273.
			const expectedArtBottom =
				headerRect.top + artTop + artTranslateY + artSize;
			const artBottom =
				albumArtRef.current?.getBoundingClientRect().bottom ??
				(albumArtUrl ? expectedArtBottom : textBottom);
			const clusterBottom = artBottom;

			// Keep first content row clear of sticky header while preserving a stable
			// cluster-to-content gap across expanded/collapsed states.
			const collapsedArtBottom = artTopCollapsed + albumArtCollapsed;
			const minGapToClearSticky = Math.max(
				0,
				collapsedHeaderHeight - collapsedArtBottom,
			);
			const effectiveGap = Math.max(
				CLUSTER_TO_CONTENT_GAP,
				minGapToClearSticky,
			);
			const headerOffset = clusterBottom - headerBottom + effectiveGap;
			const spacerHeight = Math.max(0, headerOffset);
			if (spacerRef.current) {
				spacerRef.current.style.height = `${spacerHeight}px`;
			}
		} else if (spacerRef.current) {
			spacerRef.current.style.height = "0px";
		}
		if (contentRef.current) {
			contentRef.current.style.marginTop = "0px";
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
			setWillChange(false);
			return collapseDistance;
		}

		let stepped = raw;
		const wasSnapped = snapStateRef.current !== null;

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

		const isSnapped = snapStateRef.current !== null;

		// Toggle willChange based on animation state
		if (!wasSnapped && isSnapped) {
			setWillChange(false);
		} else if (wasSnapped && !isSnapped) {
			setWillChange(true);
		}

		applyProgress(springInterpolate(stepped));
		return collapseDistance;
	};

	// Sync collapse visual state on mount/re-render.
	// Must clear lastProgressRef so applyProgress re-applies all imperative styles —
	// React re-renders overwrite properties that exist in JSX style props (e.g. hero height).
	useIsomorphicLayoutEffect(() => {
		lastProgressRef.current = null;
		applyFromCollapseOffset();
	}, [isExpanded, albumArtUrl, artistImageUrl, reduceMotion]);

	useEffect(() => {
		return () => {
			if (reducedMotionTweenRef.current != null)
				cancelAnimationFrame(reducedMotionTweenRef.current);
			if (staggerAnimationRef.current != null)
				cancelAnimationFrame(staggerAnimationRef.current);
			if (crossfadeRafRef.current != null)
				cancelAnimationFrame(crossfadeRafRef.current);
			if (analysisRafRef.current != null)
				cancelAnimationFrame(analysisRafRef.current);
		};
	}, []);

	// Soft tween for reduced motion users (150ms instead of instant)
	const tweenToTarget = (target: number, duration = 150) => {
		const start = collapseOffsetRef.current;
		const startTime = performance.now();

		const tick = (now: number) => {
			const elapsed = now - startTime;
			const t = Math.min(1, elapsed / duration);
			collapseOffsetRef.current = start + (target - start) * t;
			applyFromCollapseOffset();

			if (t < 1) {
				reducedMotionTweenRef.current = requestAnimationFrame(tick);
			} else {
				reducedMotionTweenRef.current = null;
				snapStateRef.current = target === 0 ? 0 : 1;
			}
		};

		if (reducedMotionTweenRef.current != null) {
			cancelAnimationFrame(reducedMotionTweenRef.current);
		}
		reducedMotionTweenRef.current = requestAnimationFrame(tick);
	};

	// Animate content sections fading in sequentially after panel opens
	// When indices provided, only animates those specific stagger slots
	const animateStaggerIn = (indices?: number[]) => {
		const elements = indices
			? (indices
					.map((i) => staggerRefs.current[i])
					.filter(Boolean) as HTMLDivElement[])
			: (staggerRefs.current.filter(Boolean) as HTMLDivElement[]);

		if (reduceMotion) {
			elements.forEach((el) => (el.style.opacity = "1"));
			return;
		}

		const startTime = performance.now();

		elements.forEach((el) => {
			el.style.opacity = "0";
			el.style.transform = "translateY(8px)";
		});

		const tick = (now: number) => {
			const elapsed = now - startTime;
			elements.forEach((el, i) => {
				const elementStart = i * STAGGER_DELAY;
				const progress = clamp01((elapsed - elementStart) / STAGGER_DURATION);
				const eased = springInterpolate(progress);
				el.style.opacity = `${eased}`;
				el.style.transform = `translateY(${lerp(8, 0, eased)}px)`;
			});

			const total = (elements.length - 1) * STAGGER_DELAY + STAGGER_DURATION;
			if (elapsed < total) {
				staggerAnimationRef.current = requestAnimationFrame(tick);
			}
		};

		staggerAnimationRef.current = requestAnimationFrame(tick);
	};

	// Animate Phase 2 sections (journey, key lines, mood, playlists) in/out
	const animateAnalysis = (show: boolean) => {
		if (analysisRafRef.current != null) {
			cancelAnimationFrame(analysisRafRef.current);
		}

		const wrapper = analysisRef.current;
		if (!wrapper) return;

		const phase2Elements = [3, 4, 5]
			.map((i) => staggerRefs.current[i])
			.filter(Boolean) as HTMLDivElement[];

		const playlistsEl = staggerRefs.current[2];

		if (reduceMotion) {
			if (show) {
				wrapper.style.maxHeight = "none";
				wrapper.style.overflow = "visible";
				phase2Elements.forEach((el) => {
					el.style.opacity = "1";
					el.style.transform = "translateY(0)";
				});
				if (playlistsEl) playlistsEl.style.opacity = "0";
			} else {
				phase2Elements.forEach((el) => {
					el.style.opacity = "0";
				});
				wrapper.style.maxHeight = "0";
				wrapper.style.overflow = "hidden";
				if (playlistsEl) playlistsEl.style.opacity = "1";
			}
			return;
		}

		if (show) {
			wrapper.style.maxHeight = "none";
			wrapper.style.overflow = "visible";
			if (playlistsEl) playlistsEl.style.opacity = "0";

			const startTime = performance.now();

			phase2Elements.forEach((el) => {
				el.style.opacity = "0";
				el.style.transform = "translateY(8px)";
			});

			const tick = (now: number) => {
				const elapsed = now - startTime;
				phase2Elements.forEach((el, i) => {
					const elementStart = i * STAGGER_DELAY;
					const progress = clamp01((elapsed - elementStart) / STAGGER_DURATION);
					const eased = springInterpolate(progress);
					el.style.opacity = `${eased}`;
					el.style.transform = `translateY(${lerp(8, 0, eased)}px)`;
				});

				const total =
					(phase2Elements.length - 1) * STAGGER_DELAY + STAGGER_DURATION;
				if (elapsed < total) {
					analysisRafRef.current = requestAnimationFrame(tick);
				}
			};

			analysisRafRef.current = requestAnimationFrame(tick);
		} else {
			const HIDE_DURATION = 180;
			const startTime = performance.now();

			const tick = (now: number) => {
				const elapsed = now - startTime;
				const progress = clamp01(elapsed / HIDE_DURATION);

				phase2Elements.forEach((el) => {
					el.style.opacity = `${1 - progress}`;
				});

				if (elapsed < HIDE_DURATION) {
					analysisRafRef.current = requestAnimationFrame(tick);
				} else {
					wrapper.style.maxHeight = "0";
					wrapper.style.overflow = "hidden";
					if (playlistsEl) {
						playlistsEl.style.opacity = "1";
						playlistsEl.style.transform = "translateY(0)";
					}
				}
			};

			analysisRafRef.current = requestAnimationFrame(tick);
		}
	};

	const toggleAnalysis = () => {
		const next = !isAnalysisOpen;
		setIsAnalysisOpen(next);
		animateAnalysis(next);

		const { collapseDistance } = getCollapseMetrics();
		if (next) {
			tweenToTarget(collapseDistance, 380);
		} else {
			if (scrollRef.current) scrollRef.current.scrollTop = 0;
			tweenToTarget(0, 380);
		}
	};

	useShortcut({
		key: "escape",
		handler: toggleAnalysis,
		description: "Close analysis",
		scope: "liked-detail-analysis",
		category: "actions",
		enabled: isExpanded && isAnalysisOpen,
	});

	useShortcut({
		key: "enter",
		handler: () => {
			if (analysis?.headline) toggleAnalysis();
		},
		description: "Open analysis",
		scope: "liked-detail",
		category: "actions",
		enabled: isExpanded,
	});

	// Smooth crossfade for song navigation (j/k keys)
	const animateCrossfade = (onMidpoint: () => void) => {
		if (reducedMotionTweenRef.current != null) {
			cancelAnimationFrame(reducedMotionTweenRef.current);
			reducedMotionTweenRef.current = null;
		}
		if (analysisRafRef.current != null) {
			cancelAnimationFrame(analysisRafRef.current);
			analysisRafRef.current = null;
		}

		if (reduceMotion || !contentWrapperRef.current) {
			onMidpoint();
			return;
		}

		const el = contentWrapperRef.current;
		const startTime = performance.now();
		const half = CROSSFADE_DURATION / 2;
		let swapped = false;

		const tick = (now: number) => {
			const elapsed = now - startTime;

			if (elapsed < half) {
				// Fade out
				el.style.opacity = `${1 - elapsed / half}`;
			} else if (!swapped) {
				// At midpoint, swap content
				swapped = true;
				onMidpoint();
			} else {
				// Fade in
				el.style.opacity = `${(elapsed - half) / half}`;
			}

			if (elapsed < CROSSFADE_DURATION) {
				crossfadeRafRef.current = requestAnimationFrame(tick);
			} else {
				el.style.opacity = "1";
			}
		};

		crossfadeRafRef.current = requestAnimationFrame(tick);
	};

	const onScroll = () => {
		// Hero collapse is driven by headline toggle, not scroll
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
				// Slide in/out synced with View Transition timing (300ms ease-out-quart)
				transition:
					"transform 300ms cubic-bezier(0.165, 0.84, 0.44, 1), opacity 300ms cubic-bezier(0.165, 0.84, 0.44, 1)",
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
											}}
										/>
										{/* Vignette overlay */}
										<div
											ref={vignetteRef}
											className="absolute inset-0"
											style={{
												background: vignetteGradient,
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
									}}
								/>

								{/* Genre ref anchor (genre data now lives on song, not analysis) */}
								<div
									ref={genreRef}
									className="absolute top-3 left-5"
									style={{ left: "20px" }}
								/>

								{/* Floating album art */}
								{albumArtUrl && isExpanded && (
									<div
										ref={albumArtRef}
										className={`absolute left-5 ${isDark ? "shadow-lg" : "shadow-md"}`}
										style={{
											left: `${LAYOUT.paddingX}px`,
											width: `${LAYOUT.albumArtExpanded}px`,
											height: `${LAYOUT.albumArtExpanded}px`,
											top: `${LAYOUT.heroHeight - LAYOUT.albumArtExpanded - 18}px`,
											transform: `translateY(${LAYOUT.albumArtExpanded / 3}px)`,
											boxShadow: isDark
												? `0 8px 32px ${colors.bg}`
												: `0 4px 20px ${baseTheme.primary}20`,
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
									className={`absolute flex flex-row ${isAnalysisOpen && analysis?.sonic_texture ? "items-start" : "items-end"}`}
									style={{
										overflow: "hidden",
										right: `${LAYOUT.paddingX}px`,
										// Always reserve space for album art when expanded (even while loading)
										// This prevents text from jumping when albumArtUrl loads async
										left: `${LAYOUT.paddingX + LAYOUT.albumArtExpanded + 16}px`,
										top: `${LAYOUT.heroHeight - LAYOUT.albumArtExpanded - 18}px`,
										height: `${LAYOUT.albumArtExpanded}px`,
										transform: `translateY(${LAYOUT.albumArtExpanded / 3}px)`,
									}}
								>
									<div style={{ flex: 1, minWidth: 0 }}>
										<div
											style={{
												display:
													isAnalysisOpen && analysis?.sonic_texture
														? "flex"
														: "block",
												alignItems: "baseline",
												gap:
													isAnalysisOpen && analysis?.sonic_texture ? "5px" : 0,
												minWidth: 0,
												overflow: "hidden",
											}}
										>
											<div
												ref={titleRef}
												className="leading-tight font-light"
												style={{
													fontFamily: fonts.display,
													fontSize: "24px",
													color: colors.text,
													viewTransitionName: isExpanded
														? "song-title"
														: "none",
													...(isAnalysisOpen && analysis?.sonic_texture
														? {
																fontFamily: fonts.body,
																overflow: "hidden",
																textOverflow: "ellipsis",
																whiteSpace: "nowrap",
																minWidth: 0,
																flexShrink: 1,
															}
														: {}),
												}}
											>
												{song.track.name}
											</div>
											<div
												ref={metaRef}
												className="leading-tight"
												style={{
													fontFamily: fonts.body,
													fontSize: "14px",
													color: colors.textMuted,
													viewTransitionName: isExpanded
														? "song-artist"
														: "none",
													...(isAnalysisOpen && analysis?.sonic_texture
														? {
																whiteSpace: "nowrap",
																overflow: "hidden",
																textOverflow: "ellipsis",
																minWidth: 0,
																flexShrink: 2,
															}
														: { marginTop: "0.375rem" }),
												}}
											>
												{isAnalysisOpen && analysis?.sonic_texture && (
													<span style={{ opacity: 0.35, marginRight: 3 }}>
														·
													</span>
												)}
												{song.track.artist}
											</div>
											{!isAnalysisOpen && song.track.album && (
												<div
													style={{
														fontFamily: fonts.body,
														fontSize: 12,
														lineHeight: 1.25,
														letterSpacing: "0.03em",
														color: colors.textDim,
														marginTop: 2,
													}}
												>
													{song.track.album}
												</div>
											)}
										</div>
										{isAnalysisOpen && analysis?.sonic_texture && (
											<p
												ref={sonicTextureRef}
												style={{
													fontFamily: fonts.body,
													fontSize: 10,
													fontStyle: "italic",
													lineHeight: 1.4,
													color: colorProps.textMuted,
													margin: "4px 0 0",
													overflow: "hidden",
													...(sonicTextureSingleLine
														? {}
														: {
																display: "-webkit-box",
																WebkitLineClamp: 3,
																WebkitBoxOrient: "vertical" as const,
															}),
												}}
											>
												{sonicTextureSingleLine
													? balancedLines(analysis.sonic_texture)
													: analysis.sonic_texture}
											</p>
										)}
									</div>
									{!isAnalysisOpen && (
										<SonicNumbers
											audioFeatures={song.track.audio_features}
											colorProps={colorProps}
										/>
									)}
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
							paddingLeft: "20px",
							paddingRight: "20px",
						}}
					>
						{/* Structural spacer: height driven by DOM cluster measurement in applyProgress */}
						<div ref={spacerRef} style={{ height: 0 }} />
						{/* Crossfade wrapper for song navigation transitions */}
						<div ref={contentWrapperRef}>
							{analysis ? (
								<>
									{/* Sonic row - stagger[0] */}
									<div
										ref={(el) => {
											staggerRefs.current[0] = el;
										}}
										className="mb-6"
										style={{ opacity: 0 }}
									>
										<SonicVariantNumbers
											genres={song.track.genres}
											colorProps={colorProps}
										/>
									</div>

									{/* Headline reveal - stagger[1] */}
									{analysis.headline && (
										<div
											ref={(el) => {
												staggerRefs.current[1] = el;
											}}
											className="mb-8"
											style={{ opacity: 0 }}
										>
											<AnalysisToggle
												headline={analysis.headline}
												interpretation={analysis.interpretation ?? ""}
												colorProps={colorProps}
												isOpen={isAnalysisOpen}
												onToggle={toggleAnalysis}
											/>
											{analysis.themes && analysis.themes.length > 0 && (
												<div style={{ marginTop: 10 }}>
													<p
														style={{
															fontFamily: fonts.body,
															fontSize: 9,
															letterSpacing: "0.05em",
															color: colorProps.textDim,
															opacity: 0.7,
															margin: 0,
														}}
													>
														{analysis.themes.map((t) => t.name).join("  ·  ")}
													</p>
												</div>
											)}
										</div>
									)}

									{/* Phase 2: deep analysis sections, hidden until headline toggle */}
									<div
										ref={analysisRef}
										style={{
											maxHeight: analysis.headline ? 0 : "none",
											overflow: analysis.headline ? "hidden" : "visible",
										}}
									>
										{/* Journey - stagger[3] */}
										{analysis.journey && analysis.journey.length > 0 && (
											<div
												ref={(el) => {
													staggerRefs.current[3] = el;
												}}
												className="mb-6"
												style={{ opacity: 0 }}
											>
												<HorizontalJourney
													journey={analysis.journey}
													colors={colorProps}
												/>
											</div>
										)}

										{/* Key lines - stagger[4] */}
										{analysis.key_lines && analysis.key_lines.length > 0 && (
											<div
												ref={(el) => {
													staggerRefs.current[4] = el;
												}}
												className="mb-6"
												style={{ opacity: 0 }}
											>
												<KeyLinesSection
													keyLines={analysis.key_lines}
													colors={colorProps}
												/>
											</div>
										)}

										{/* Footer: mood - stagger[5] */}
										{(analysis.compound_mood || analysis.mood_description) && (
											<div
												ref={(el) => {
													staggerRefs.current[5] = el;
												}}
												className="space-y-2"
												style={{
													borderTop: `1px solid ${colors.border}`,
													paddingTop: 20,
													marginTop: 8,
													opacity: 0,
												}}
											>
												{analysis.compound_mood && (
													<span
														style={{
															fontFamily: fonts.body,
															fontSize: 10,
															fontWeight: 500,
															letterSpacing: "0.1em",
															textTransform: "uppercase",
															color: colors.accent,
															display: "block",
														}}
													>
														{analysis.compound_mood}
													</span>
												)}
												{analysis.mood_description && (
													<p
														style={{
															fontFamily: fonts.body,
															fontStyle: "italic",
															fontSize: 13,
															lineHeight: 1.6,
															color: colors.textMuted,
														}}
													>
														{analysis.mood_description}
													</p>
												)}
											</div>
										)}
									</div>

									{/* Playlists - stagger[2] (outside Phase 2, always visible) */}
									<div
										ref={(el) => {
											staggerRefs.current[2] = el;
										}}
										className="mt-5"
										style={{ opacity: 0 }}
									>
										<PlaylistsSection
											playlists={mockPlaylists}
											addedTo={addedTo}
											isOtherExpanded={expandedSections.has("other-playlists")}
											onAdd={handleAddToPlaylist}
											onToggleOther={() => toggleSection("other-playlists")}
											onSkip={onClose}
											onMarkSorted={onClose}
											colors={colorProps}
										/>
									</div>
								</>
							) : (
								<div
									ref={(el) => {
										staggerRefs.current[0] = el;
									}}
									style={{ opacity: 0 }}
								>
									<p
										className="text-sm italic"
										style={{
											fontFamily: fonts.body,
											color: colors.textMuted,
										}}
									>
										Analysis in progress...
									</p>
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export default SongDetailPanelNew;
