import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useShortcut } from "@/lib/keyboard/useShortcut";
import { ANIMATION_TIMING, LAYOUT, PANEL_KEYFRAMES } from "./panel-constants";
import {
	clamp01,
	lerp,
	smoothstep,
	springInterpolate,
} from "./panel-interpolation";
import type { PanelColors } from "./types";

const useIsomorphicLayoutEffect =
	typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface UsePanelAnimationOptions {
	isExpanded: boolean;
	songId: string;
	albumArtUrl?: string;
	artistImageUrl?: string;
	panelColors: PanelColors;
	hasHeadline: boolean;
	sonicTextureText?: string;
	stackMetaBelowArt?: boolean;
}

export interface PanelAnimationRefs {
	scrollRef: React.RefObject<HTMLDivElement | null>;
	headerRef: React.RefObject<HTMLDivElement | null>;
	heroRef: React.RefObject<HTMLDivElement | null>;
	artistImageRef: React.RefObject<HTMLDivElement | null>;
	vignetteRef: React.RefObject<HTMLDivElement | null>;
	bottomFadeRef: React.RefObject<HTMLDivElement | null>;
	genreRef: React.RefObject<HTMLDivElement | null>;
	albumArtRef: React.RefObject<HTMLDivElement | null>;
	textBlockRef: React.RefObject<HTMLDivElement | null>;
	titleRef: React.RefObject<HTMLDivElement | null>;
	metaRef: React.RefObject<HTMLDivElement | null>;
	contentRef: React.RefObject<HTMLDivElement | null>;
	spacerRef: React.RefObject<HTMLDivElement | null>;
	crossfadeContentRef: React.RefObject<HTMLDivElement | null>;
	analysisPhaseRef: React.RefObject<HTMLDivElement | null>;
	sonicTextureRef: React.RefObject<HTMLParagraphElement | null>;
}

export function usePanelAnimation(options: UsePanelAnimationOptions) {
	const {
		isExpanded,
		songId,
		albumArtUrl,
		artistImageUrl,
		panelColors,
		hasHeadline,
		sonicTextureText,
		stackMetaBelowArt = false,
	} = options;

	// Stale closure prevention — panelColors and albumArtUrl are read inside rAF callbacks
	const panelColorsRef = useRef(panelColors);
	panelColorsRef.current = panelColors;
	const albumArtUrlRef = useRef(albumArtUrl);
	albumArtUrlRef.current = albumArtUrl;

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
	const currentSongIdRef = useRef<string | null>(null);

	const staggerRefs = useRef<(HTMLDivElement | null)[]>([]);
	const staggerAnimationRef = useRef<number | null>(null);
	const crossfadeContentRef = useRef<HTMLDivElement | null>(null);
	const crossfadeRafRef = useRef<number | null>(null);
	const analysisPhaseRef = useRef<HTMLDivElement | null>(null);
	const analysisRafRef = useRef<number | null>(null);
	const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);
	const sonicTextureRef = useRef<HTMLParagraphElement | null>(null);
	const [sonicTextureSingleLine, setSonicTextureSingleLine] = useState(false);

	const {
		staggerDelay: STAGGER_DELAY,
		staggerDuration: STAGGER_DURATION,
		crossfadeDuration: CROSSFADE_DURATION,
		parallaxRatio: PARALLAX_RATIO,
		clusterToContentGap: CLUSTER_TO_CONTENT_GAP,
	} = ANIMATION_TIMING;

	// Stable ref callbacks for stagger slots (avoids creating new functions each render)
	const staggerRefCallbacks = useRef<((el: HTMLDivElement | null) => void)[]>(
		[],
	);
	const getStaggerRef = (index: number) => {
		if (!staggerRefCallbacks.current[index]) {
			staggerRefCallbacks.current[index] = (el: HTMLDivElement | null) => {
				staggerRefs.current[index] = el;
			};
		}
		return staggerRefCallbacks.current[index];
	};

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
		if (!el || !isAnalysisOpen || !sonicTextureText) {
			setSonicTextureSingleLine(false);
			return;
		}
		const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 14;
		setSonicTextureSingleLine(el.scrollHeight <= lineHeight * 1.2);
	}, [isAnalysisOpen, sonicTextureText]);

	useEffect(() => {
		const id = "hearted-panel-keyframes";
		if (!document.getElementById(id)) {
			const style = document.createElement("style");
			style.id = id;
			style.textContent = PANEL_KEYFRAMES;
			document.head.appendChild(style);
		}
	}, []);

	const closeAnalysis = () => {
		setIsAnalysisOpen(false);
		if (analysisPhaseRef.current && hasHeadline) {
			analysisPhaseRef.current.style.maxHeight = "0";
			analysisPhaseRef.current.style.overflow = "hidden";
		}
	};

	const setWillChange = (active: boolean) => {
		const value = active ? "transform, opacity" : "auto";
		const sizeValue = active
			? "transform, top, width, height, opacity"
			: "auto";
		const fontValue = active ? "font-size" : "auto";

		if (heroRef.current)
			heroRef.current.style.willChange = active ? "height" : "auto";
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

		const textLeftExpanded = stackMetaBelowArt
			? paddingX
			: paddingX + albumArtExpanded + 16;
		const textLeftCollapsed = paddingX + albumArtCollapsed + 16;
		const textLeft = lerp(textLeftExpanded, textLeftCollapsed, progress);
		const textTopExpanded = stackMetaBelowArt
			? artTopExpanded + albumArtExpanded + 16
			: artTopExpanded;
		const textTopCollapsed = artTopCollapsed;
		const textTop = lerp(textTopExpanded, textTopCollapsed, progress);
		const textHeightExpanded = stackMetaBelowArt ? 84 : albumArtExpanded;
		const textHeightCollapsed = albumArtCollapsed;
		const textHeight = lerp(textHeightExpanded, textHeightCollapsed, progress);
		const titleSize = lerp(24, 16, progress);
		const metaSize = lerp(14, 12, progress);

		if (headerRef.current) {
			headerRef.current.style.borderBottomColor = `${panelColorsRef.current.border}${Math.round(
				borderOpacity * 255,
			)
				.toString(16)
				.padStart(2, "0")}`;
		}
		if (heroRef.current) heroRef.current.style.height = `${heroHeight}px`;
		const parallaxOffset =
			progress * (expandedHeroHeight - collapsedHeaderHeight) * PARALLAX_RATIO;
		if (artistImageRef.current) {
			artistImageRef.current.style.opacity = `${imageOpacity}`;
			artistImageRef.current.style.transform = `translateY(-${parallaxOffset}px)`;
		}
		if (vignetteRef.current)
			vignetteRef.current.style.opacity = `${imageOpacity}`;
		if (genreRef.current) genreRef.current.style.opacity = `${imageOpacity}`;
		const bottomFadeOpacity = smoothstep(clamp01(progress * 2));
		if (bottomFadeRef.current)
			bottomFadeRef.current.style.opacity = `${bottomFadeOpacity}`;

		if (albumArtRef.current) {
			albumArtRef.current.style.left = `${paddingX}px`;
			albumArtRef.current.style.width = `${artSize}px`;
			albumArtRef.current.style.height = `${artSize}px`;
			albumArtRef.current.style.top = `${artTop}px`;
			albumArtRef.current.style.transform = `translateY(${artTranslateY}px)`;
			albumArtRef.current.style.opacity = albumArtUrlRef.current ? "1" : "0";
		}

		if (textBlockRef.current) {
			textBlockRef.current.style.left = `${textLeft}px`;
			textBlockRef.current.style.top = `${textTop}px`;
			textBlockRef.current.style.right = `${paddingX}px`;
			textBlockRef.current.style.height = `${textHeight}px`;
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
			const expectedArtBottom =
				headerRect.top + artTop + artTranslateY + artSize;
			const artBottom =
				albumArtRef.current?.getBoundingClientRect().bottom ??
				(albumArtUrlRef.current ? expectedArtBottom : textBottom);
			const clusterBottom = Math.max(artBottom, textBottom);

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
		const { heroHeight, collapsedHeaderHeight } = LAYOUT;
		const collapseDistance = heroHeight - collapsedHeaderHeight;
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

		if (!wasSnapped && isSnapped) {
			setWillChange(false);
		} else if (wasSnapped && !isSnapped) {
			setWillChange(true);
		}

		applyProgress(springInterpolate(stepped));
		return collapseDistance;
	};

	useIsomorphicLayoutEffect(() => {
		lastProgressRef.current = null;
		applyFromCollapseOffset();
	}, [
		isExpanded,
		albumArtUrl,
		artistImageUrl,
		reduceMotion,
		stackMetaBelowArt,
	]);

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

	const animateAnalysis = (show: boolean) => {
		if (analysisRafRef.current != null) {
			cancelAnimationFrame(analysisRafRef.current);
		}

		const wrapper = analysisPhaseRef.current;
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

	const animateCrossfade = (onMidpoint: () => void) => {
		if (reducedMotionTweenRef.current != null) {
			cancelAnimationFrame(reducedMotionTweenRef.current);
			reducedMotionTweenRef.current = null;
		}
		if (analysisRafRef.current != null) {
			cancelAnimationFrame(analysisRafRef.current);
			analysisRafRef.current = null;
		}

		if (reduceMotion || !crossfadeContentRef.current) {
			onMidpoint();
			return;
		}

		const el = crossfadeContentRef.current;
		const startTime = performance.now();
		const half = CROSSFADE_DURATION / 2;
		let swapped = false;

		const tick = (now: number) => {
			const elapsed = now - startTime;

			if (elapsed < half) {
				el.style.opacity = `${1 - elapsed / half}`;
			} else if (!swapped) {
				swapped = true;
				onMidpoint();
			} else {
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

	// Hero collapse is driven by headline toggle, not scroll events
	const onScroll = () => {};

	// Trigger stagger animation when panel expands
	useEffect(() => {
		if (isExpanded) {
			closeAnalysis();
			const indices = hasHeadline ? [0, 1, 2] : undefined;
			const id = setTimeout(() => animateStaggerIn(indices), 80);
			return () => clearTimeout(id);
		}
	}, [isExpanded]);

	// Reset collapse state when displayed song changes
	useEffect(() => {
		if (songId !== currentSongIdRef.current) {
			const hadPrevious = currentSongIdRef.current !== null;

			if (hadPrevious && isExpanded) {
				animateCrossfade(() => {
					currentSongIdRef.current = songId;
					lastProgressRef.current = null;
					if (scrollRef.current) {
						scrollRef.current.scrollTop = 0;
					}

					const shouldKeepAnalysis = isAnalysisOpen && hasHeadline;

					if (shouldKeepAnalysis) {
						const { collapseDistance } = getCollapseMetrics();
						collapseOffsetRef.current = collapseDistance;
						snapStateRef.current = 1;
						applyProgress(1);
						if (analysisPhaseRef.current) {
							analysisPhaseRef.current.style.maxHeight = "none";
							analysisPhaseRef.current.style.overflow = "visible";
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
						const visibleIndices = hasHeadline ? [0, 1, 2] : [0];
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
				currentSongIdRef.current = songId;
				collapseOffsetRef.current = 0;
				snapStateRef.current = 0;
				lastProgressRef.current = null;
				if (scrollRef.current) {
					scrollRef.current.scrollTop = 0;
				}
				applyProgress(0);
			}
		}
	}, [songId, isExpanded]);

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
			if (hasHeadline) toggleAnalysis();
		},
		description: "Open analysis",
		scope: "liked-detail",
		category: "actions",
		enabled: isExpanded,
	});

	return {
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
		} satisfies PanelAnimationRefs,
		getStaggerRef,
		isAnalysisOpen,
		sonicTextureSingleLine,
		toggleAnalysis,
		onScroll,
	};
}
