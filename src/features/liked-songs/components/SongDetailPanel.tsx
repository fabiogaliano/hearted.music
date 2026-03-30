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
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useShortcut } from "@/lib/keyboard/useShortcut";
import { songSuggestionsQueryOptions } from "../queries";
import { useThemeWithOverride } from "@/lib/theme/ThemeHueProvider";
import type { ThemeConfig } from "@/lib/theme/types";
import { extractHue } from "@/lib/utils/color";
import type { AnalysisContent, LikedSong } from "../types";
import { PanelContent } from "./detail/PanelContent";
import { PanelHero } from "./detail/PanelHero";
import { LAYOUT } from "./detail/panel-constants";
import { getThemedDarkColors } from "./detail/themed-dark-colors";
import type { ColorProps, PanelColors } from "./detail/types";
import { usePanelAnimation } from "./detail/usePanelAnimation";

// Types

export interface SongDetailPanelProps {
	/** Optional theme override - for dark mode or special cases */
	theme?: ThemeConfig;
	song: LikedSong;
	albumArtUrl?: string;
	artistImageUrl?: string;
	isExpanded: boolean;
	/** Starting rect for FLIP animation origin (null = render without enter animation) */
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
	/** Whether the enrichment pipeline is currently running */
	isEnrichmentRunning?: boolean;
}

export function SongDetailPanel({
	theme: themeOverride,
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	startRect: _startRect,
	onClose,
	onNext,
	onPrevious,
	hasNext,
	hasPrevious,
	isDark = false,
	isEnrichmentRunning = false,
}: SongDetailPanelProps) {
	const baseTheme = useThemeWithOverride(themeOverride);
	const darkPalette = isDark ? getThemedDarkColors(baseTheme) : null;
	const hue = extractHue(baseTheme.primary);

	const panelColors: PanelColors = {
		bg: isDark ? darkPalette!.bg : baseTheme.bg,
		bgLight: isDark ? darkPalette!.bgLight : baseTheme.surface,
		surface: isDark ? darkPalette!.surface : baseTheme.surface,
		surfaceHover: isDark ? darkPalette!.surfaceHover : baseTheme.surfaceDim,
		text: isDark ? darkPalette!.text : baseTheme.text,
		textMuted: isDark ? darkPalette!.textMuted : baseTheme.textMuted,
		textDim: isDark ? darkPalette!.textDim : baseTheme.textMuted,
		separator: isDark ? darkPalette!.textDim : baseTheme.border,
		border: isDark ? darkPalette!.border : baseTheme.border,
		accent: isDark ? darkPalette!.accent : baseTheme.primary,
		accentMuted: isDark ? darkPalette!.accentMuted : baseTheme.primaryHover,
	};

	const [expandedSections, setExpandedSections] = useState<Set<string>>(
		new Set(),
	);

	const { data: suggestions } = useQuery(
		songSuggestionsQueryOptions(song.track.id),
	);

	const analysis = song.analysis?.analysis as AnalysisContent | undefined;
	const heroHeight = artistImageUrl
		? LAYOUT.heroHeight
		: LAYOUT.heroHeightNoImage;

	const colorProps: ColorProps = {
		text: panelColors.text,
		textMuted: panelColors.textMuted,
		textDim: panelColors.textDim,
		accent: panelColors.accent,
		accentMuted: panelColors.accentMuted,
		border: panelColors.border,
		surface: panelColors.surface,
		surfaceHover: panelColors.surfaceHover,
		bg: panelColors.bg,
	};

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

	const {
		refs: {
			scrollRef,
			headerRef,
			heroRef,
			artistImageRef,
			vignetteRef,
			bottomFadeRef,
			genreRef,
			albumArtRef,
			textBlockRef,
			titleRef,
			metaRef,
			contentRef,
			spacerRef,
			crossfadeContentRef,
			analysisPhaseRef,
			sonicTextureRef,
		},
		getStaggerRef,
		isAnalysisOpen,
		sonicTextureSingleLine,
		toggleAnalysis,
		onScroll,
	} = usePanelAnimation({
		isExpanded,
		songId: song.track.id,
		albumArtUrl,
		artistImageUrl,
		panelColors,
		hasHeadline: !!analysis?.headline,
		sonicTextureText: analysis?.sonic_texture,
		heroHeight,
	});

	const vignetteGradient = isDark
		? `radial-gradient(ellipse at center, transparent 20%, ${darkPalette!.bgVignette} 100%),
		   linear-gradient(to bottom, transparent 40%, ${darkPalette!.bgFade} 100%)`
		: `linear-gradient(to bottom,
			hsla(${hue}, 25%, 88%, 0) 0%,
			hsla(${hue}, 25%, 88%, 0.1) 57%,
			hsla(${hue}, 25%, 88%, 0.8) 80%,
			hsla(${hue}, 25%, 88%, 1) 100%)`;

	return (
		<div
			className="z-50 overflow-hidden"
			style={{
				position: "fixed",
				borderLeft: isDark ? "none" : `1px solid ${baseTheme.border}`,
				transition:
					"transform 300ms cubic-bezier(0.165, 0.84, 0.44, 1), opacity 300ms cubic-bezier(0.165, 0.84, 0.44, 1)",
				top: 0,
				right: 0,
				width: "clamp(380px, 45vw, calc(100vw - 280px))",
				height: "100vh",
				transform: isExpanded ? "translateX(0)" : "translateX(100%)",
				opacity: isExpanded ? 1 : 0,
				pointerEvents: isExpanded ? "auto" : "none",
			}}
		>
			<div className="h-full" style={{ background: panelColors.bg }}>
				<div
					ref={scrollRef}
					onScroll={onScroll}
					className="h-full overflow-y-auto"
					style={{ overscrollBehaviorY: "contain" }}
				>
					<PanelHero
						colors={panelColors}
						colorProps={colorProps}
						isDark={isDark}
						vignetteGradient={vignetteGradient}
						artistImageUrl={artistImageUrl}
						albumArtUrl={albumArtUrl}
						isExpanded={isExpanded}
						isAnalysisOpen={isAnalysisOpen}
						sonicTextureSingleLine={sonicTextureSingleLine}
						song={song}
						analysis={analysis}
						baseTheme={baseTheme}
						heroHeight={heroHeight}
						onClose={onClose}
						onNext={onNext}
						onPrevious={onPrevious}
						hasNext={hasNext}
						hasPrevious={hasPrevious}
						refs={{
							headerRef,
							heroRef,
							artistImageRef,
							vignetteRef,
							bottomFadeRef,
							genreRef,
							albumArtRef,
							textBlockRef,
							titleRef,
							metaRef,
							sonicTextureRef,
						}}
					/>
					<PanelContent
						colors={panelColors}
						colorProps={colorProps}
						song={song}
						analysis={analysis}
						isAnalysisOpen={isAnalysisOpen}
						toggleAnalysis={toggleAnalysis}
						expandedSections={expandedSections}
						toggleSection={toggleSection}
						suggestions={suggestions?.matches ?? null}
						isEnrichmentRunning={isEnrichmentRunning}
						getStaggerRef={getStaggerRef}
						refs={{
							contentRef,
							spacerRef,
							crossfadeContentRef,
							analysisPhaseRef,
						}}
					/>
				</div>
			</div>
		</div>
	);
}
