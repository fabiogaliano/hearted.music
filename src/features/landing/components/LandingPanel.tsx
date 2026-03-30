/**
 * Inline version of SongDetailPanel for the landing page hero.
 * Reuses production PanelHero + PanelContent without fixed positioning.
 */
import { useEffect, useRef, useState } from "react";
import type { AnalysisContent, LikedSong } from "@/features/liked-songs/types";
import { LandingPanelContent } from "./LandingPanelContent";
import { PanelHero } from "@/features/liked-songs/components/detail/PanelHero";
import type { PanelColors } from "@/features/liked-songs/components/detail/types";
import { LAYOUT } from "@/features/liked-songs/components/detail/panel-constants";
import { usePanelAnimation } from "@/features/liked-songs/components/detail/usePanelAnimation";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { withAlpha } from "@/lib/utils/color";

const SWIPE_MIN_DISTANCE_PX = 44;
const STACK_META_BREAKPOINT_PX = 760;

export interface LandingPanelProps {
	song: LikedSong;
	albumArtUrl?: string;
	artistImageUrl?: string;
	onPrev: () => void;
	onNext: () => void;
}

export function LandingPanel({
	song,
	albumArtUrl,
	artistImageUrl,
	onPrev,
	onNext,
}: LandingPanelProps) {
	const baseTheme = useTheme();
	const panelRootRef = useRef<HTMLDivElement>(null);
	const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
	// TODO: Replace ResizeObserver layout correction with CSS container queries
	// to avoid post-mount reflow on first paint. See audit finding #7.
	const [stackMetaBelowArt, setStackMetaBelowArt] = useState(true);

	useEffect(() => {
		const panelRoot = panelRootRef.current;
		if (!panelRoot || typeof ResizeObserver === "undefined") return;

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			setStackMetaBelowArt(entry.contentRect.width <= STACK_META_BREAKPOINT_PX);
		});

		observer.observe(panelRoot);
		return () => observer.disconnect();
	}, []);

	const panelColors: PanelColors = {
		bg: baseTheme.bg,
		bgLight: baseTheme.surface,
		surface: baseTheme.surface,
		surfaceHover: baseTheme.surfaceDim,
		text: baseTheme.text,
		textMuted: baseTheme.textMuted,
		textDim: baseTheme.textMuted,
		separator: baseTheme.border,
		border: baseTheme.border,
		accent: baseTheme.primary,
		accentMuted: baseTheme.primaryHover,
	};

	const analysis = song.analysis?.analysis as AnalysisContent | undefined;
	const bgWithAlpha = (alpha: number) => withAlpha(panelColors.bg, alpha);

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
		isExpanded: true,
		songId: song.track.id,
		albumArtUrl,
		artistImageUrl,
		panelColors,
		hasHeadline: !!analysis?.headline,
		sonicTextureText: analysis?.sonic_texture,
		stackMetaBelowArt,
	});

	const vignetteGradient = `linear-gradient(to bottom,
		${bgWithAlpha(0)} 0%,
		${bgWithAlpha(0.08)} 52%,
		${bgWithAlpha(0.62)} 78%,
		${panelColors.bg} 100%)`;

	const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
		const touch = event.touches[0];
		if (!touch) return;

		const scrollContainer = event.currentTarget;
		const rect = scrollContainer.getBoundingClientRect();
		const contentY = scrollContainer.scrollTop + (touch.clientY - rect.top);
		if (contentY > LAYOUT.heroHeight) {
			swipeStartRef.current = null;
			return;
		}

		swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
	};

	const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
		const start = swipeStartRef.current;
		swipeStartRef.current = null;
		if (!start) return;

		const touch = event.changedTouches[0];
		if (!touch) return;

		const deltaX = touch.clientX - start.x;
		const deltaY = touch.clientY - start.y;
		const absX = Math.abs(deltaX);
		const absY = Math.abs(deltaY);

		if (absX < SWIPE_MIN_DISTANCE_PX || absX <= absY) return;

		if (deltaX < 0) {
			onNext();
			return;
		}

		onPrev();
	};

	const noop = () => {};

	return (
		<div
			ref={panelRootRef}
			className="relative h-full w-full overflow-hidden"
			style={{ background: panelColors.bg }}
		>
			<style>{`
				@keyframes landing-panel-hero-enter {
					from {
						opacity: 0;
						transform: translateY(8px) scale(1.015);
					}
					to {
						opacity: 1;
						transform: translateY(0) scale(1);
					}
				}

				.landing-panel-hero-enter {
					animation: landing-panel-hero-enter
						240ms cubic-bezier(0.215, 0.61, 0.355, 1) both;
					will-change: transform, opacity;
				}

				@media (prefers-reduced-motion: reduce) {
					.landing-panel-hero-enter {
						animation: none;
						will-change: auto;
					}
				}
			`}</style>

			<div className="h-full" style={{ background: panelColors.bg }}>
				<div
					ref={scrollRef}
					onScroll={onScroll}
					onTouchStart={handleTouchStart}
					onTouchEnd={handleTouchEnd}
					className="h-full overflow-y-auto"
					style={{ overscrollBehavior: "auto" }}
				>
					<div
						key={`hero-${song.track.id}`}
						className="landing-panel-hero-enter"
					>
						<PanelHero
							colors={panelColors}
							colorProps={panelColors}
							isDark={false}
							vignetteGradient={vignetteGradient}
							artistImageUrl={artistImageUrl}
							albumArtUrl={albumArtUrl}
							isExpanded={true}
							isAnalysisOpen={isAnalysisOpen}
							sonicTextureSingleLine={sonicTextureSingleLine}
							stackMetaBelowArt={stackMetaBelowArt}
							song={song}
							analysis={analysis}
							baseTheme={baseTheme}
							heroHeight={
								artistImageUrl ? LAYOUT.heroHeight : LAYOUT.heroHeightNoImage
							}
							onClose={noop}
							onNext={onNext}
							onPrevious={onPrev}
							hasNext={true}
							hasPrevious={true}
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
					</div>
					<LandingPanelContent
						colors={panelColors}
						colorProps={panelColors}
						song={song}
						analysis={analysis}
						isAnalysisOpen={isAnalysisOpen}
						toggleAnalysis={toggleAnalysis}
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
