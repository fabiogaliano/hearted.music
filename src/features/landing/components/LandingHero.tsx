import { useEffect, useRef, useState } from "react";

import {
	HeartRippleBackground,
	type HeartRippleHandle,
} from "@/components/ui/HeartRippleBackground";
import { HeartRipplePlaceholder } from "@/components/ui/HeartRipplePlaceholder";
import { toLikedSong, type LandingSongForUI } from "@/lib/data/landing-songs";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { extractHue, getPastelColor } from "@/lib/utils/color";
import { AnimatedHeart } from "./AnimatedHeart";
import { heroStyles } from "./heroStyles";
import { LandingPanel } from "./LandingPanel";
import { SpotifyLoginButton } from "./SpotifyLoginButton";
import { useHeroAnimation } from "./useHeroAnimation";
import { WaitlistInput } from "./WaitlistInput";

export interface LandingHeroProps {
	featuredSong: LandingSongForUI;
	albumArtUrl?: string;
	artistImageUrl: string | undefined;
	onPrev: () => void;
	onNext: () => void;
	/** Whether the app is in released mode (shows login) vs pre-release (shows waitlist) */
	isReleased?: boolean;
}

export function LandingHero({
	featuredSong,
	albumArtUrl,
	artistImageUrl,
	onPrev,
	onNext,
	isReleased = true,
}: LandingHeroProps) {
	const theme = useTheme();
	const likedSong = toLikedSong(featuredSong);
	const [isBackgroundReady, setIsBackgroundReady] = useState(false);
	const [isDesktopLayout, setIsDesktopLayout] = useState(() =>
		typeof window !== "undefined"
			? window.matchMedia("(min-width: 1280px)").matches
			: false,
	);
	const [isHeroVisualReady, setIsHeroVisualReady] = useState(false);
	const [hasRevealed, setHasRevealed] = useState(false);

	const sectionRef = useRef<HTMLElement>(null);
	const pinnedContentRef = useRef<HTMLDivElement>(null);
	const heartRippleRef = useRef<HeartRippleHandle>(null);
	const logoRef = useRef<HTMLHeadingElement>(null);
	const headlineRef = useRef<HTMLHeadingElement>(null);
	const backgroundRef = useRef<HTMLDivElement>(null);
	const backgroundInnerRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const panelCurtainRef = useRef<HTMLDivElement>(null);
	const ctaRef = useRef<HTMLDivElement>(null);
	const subtextRef = useRef<HTMLParagraphElement>(null);
	const heartRef = useRef<HTMLSpanElement>(null);
	const navBtnRef = useRef<HTMLButtonElement>(null);
	const scrollIndicatorRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (typeof window === "undefined") return;

		const mediaQuery = window.matchMedia("(min-width: 1280px)");
		const handleChange = () => {
			if (mediaQuery.matches !== isDesktopLayout) {
				setIsHeroVisualReady(false);
				setIsDesktopLayout(mediaQuery.matches);
			}
		};

		handleChange();

		if (typeof mediaQuery.addEventListener === "function") {
			mediaQuery.addEventListener("change", handleChange);
			return () => mediaQuery.removeEventListener("change", handleChange);
		}

		mediaQuery.addListener(handleChange);
		return () => mediaQuery.removeListener(handleChange);
	}, [isDesktopLayout]);

	// Initialize GSAP ScrollTrigger animation
	useHeroAnimation(
		{
			sectionRef,
			pinnedContentRef,
			logoRef,
			headlineRef,
			backgroundRef,
			backgroundInnerRef,
			panelRef,
			panelCurtainRef,
			ctaRef,
			subtextRef,
			heartRef,
			navBtnRef,
			scrollIndicatorRef,
		},
		{
			isBackgroundReady: true,
			isDesktopLayout,
			onInitialStateApplied: () => setIsHeroVisualReady(true),
			onRevealComplete: () => setHasRevealed(true),
			onRevealReverse: () => setHasRevealed(false),
		},
	);

	// Pointer tracking for WebGL background - uses RAF throttling to avoid re-renders
	useEffect(() => {
		const container = pinnedContentRef.current;
		if (!container) return;

		// RAF-throttled pointer update
		let pending: { x: number; y: number } | null = null;
		let rafId: number | null = null;

		const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

		const scheduleUpdate = () => {
			if (rafId != null) return;
			rafId = requestAnimationFrame(() => {
				rafId = null;
				if (!pending) return;
				heartRippleRef.current?.setPointer(pending);
				pending = null;
			});
		};

		const getPointerPosition = (ev: PointerEvent) => {
			const rect = container.getBoundingClientRect();
			const x = clamp01((ev.clientX - rect.left) / rect.width);
			const y = clamp01(1 - (ev.clientY - rect.top) / rect.height);
			return { x, y };
		};

		const handlePointerMove = (ev: PointerEvent) => {
			const { x, y } = getPointerPosition(ev);
			pending = { x, y };
			scheduleUpdate();
		};

		const handlePointerDown = (ev: PointerEvent) => {
			const { x, y } = getPointerPosition(ev);
			heartRippleRef.current?.setPointer({ x, y, strength: 1 });
		};

		window.addEventListener("pointermove", handlePointerMove, {
			passive: true,
		});
		window.addEventListener("pointerdown", handlePointerDown, {
			passive: true,
		});

		return () => {
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerdown", handlePointerDown);
			if (rafId != null) {
				cancelAnimationFrame(rafId);
			}
		};
	}, []);

	// Compute pastel color for hero text (same as heart)
	const themeHue = extractHue(theme.primary);
	const pastelColor = getPastelColor(themeHue);

	return (
		<>
			<style>{heroStyles}</style>

			{/* ───────────────────────────────────────────────────────────────────
			    HERO SECTION - Cinematic Morph Reveal with GSAP ScrollTrigger

			    Structure for GSAP pin:
			    - Section acts as trigger (200vh via GSAP pinSpacing)
			    - Pinned content stays fixed during scroll
			    - GSAP animates all morph elements based on scroll progress
			    ─────────────────────────────────────────────────────────────────── */}
			<section
				ref={sectionRef}
				className="hero-section relative min-h-screen snap-start snap-always xl:min-h-[300vh]"
			>
				{/* Pinned content - GSAP pins this during scroll */}
				<div
					ref={pinnedContentRef}
					className="hero-pinned-content relative h-screen w-full overflow-hidden xl:sticky xl:top-0"
				>
					{/* Background container - morphs from 100vw to 50% */}
					<div
						ref={backgroundRef}
						className="hero-background absolute inset-y-0 left-0 z-0 overflow-hidden"
						style={{ width: "100%" }}
					>
						{/* Counter-scaled content wrapper to preserve aspect ratio during shrink */}
						<div
							ref={backgroundInnerRef}
							className="hero-background-inner absolute inset-0"
						>
							<div className="absolute inset-0 z-0">
								<HeartRipplePlaceholder />
							</div>
							<div
								className={`absolute inset-0 z-10 transition-opacity duration-1000 ${isBackgroundReady ? "opacity-100" : "opacity-0"}`}
							>
								<HeartRippleBackground
									ref={heartRippleRef}
									onReady={() => setIsBackgroundReady(true)}
								/>
							</div>
						</div>
					</div>

					<div className="pointer-events-none relative z-10 grid min-h-screen xl:grid-cols-2">
						{/* Left: Copy column - elements morph from center to here */}
						<div
							className={`hero-initial-fade ${isHeroVisualReady ? "is-ready" : ""} pointer-events-none relative flex min-h-screen flex-col justify-center overflow-visible px-6 py-16 sm:px-8 md:px-10 xl:min-h-0 xl:px-16`}
						>
							{/* Navigation - logo morphs here, button fades in */}
							<nav className="pointer-events-none mb-8 flex items-center justify-between xl:mb-10">
								<h1
									ref={logoRef}
									className="hero-logo flex items-center text-2xl font-extralight tracking-tight"
									style={{
										fontFamily: fonts.display,
										color: "#ffffff",
										willChange: "transform",
									}}
								>
									<span
										ref={heartRef}
										className="hero-logo-heart inline-flex items-center"
										style={{ width: 0, minWidth: 0, opacity: 0 }}
									>
										<span
											style={{
												fontSize: "0.65em",
												marginRight: "0.25em",
												flexShrink: 0,
											}}
										>
											<AnimatedHeart shouldAutoPlay={hasRevealed} />
										</span>
									</span>
									hearted.
								</h1>
								<button
									ref={navBtnRef}
									className="hero-nav-btn pointer-events-auto px-5 py-2 text-sm tracking-widest uppercase transition-all duration-300 hover:scale-105 xl:hidden"
									style={{
										background: "rgba(255,255,255,0.2)",
										color: "#ffffff",
										fontFamily: fonts.body,
										backdropFilter: "blur(10px)",
										opacity: 0, // Initial state, GSAP animates
									}}
								>
									Get early access
								</button>
							</nav>

							<div className="pointer-events-none max-w-lg">
								<h2
									ref={headlineRef}
									className="hero-headline text-4xl leading-[1.1] font-extralight sm:text-5xl xl:flex xl:text-6xl"
									style={{
										fontFamily: fonts.display,
										color: pastelColor,
										willChange: "transform, max-width",
									}}
								>
									<span className="block xl:inline">
										the stories inside&nbsp;
									</span>
									<span className="block italic xl:inline">
										your liked songs
									</span>
								</h2>

								{/* Subtext - fades in late in scroll */}
								<p
									ref={subtextRef}
									className="hero-subtext mt-3 text-lg leading-relaxed xl:text-xl"
									style={{
										color: theme.textOnPrimary,
										opacity: 0,
										transform: "translateY(10px)",
									}}
								>
									what do they say about you?
								</p>

								{/* CTA - fades in late in scroll */}
								<div
									ref={ctaRef}
									className="hero-cta pointer-events-auto mt-6"
									style={{ opacity: 0, transform: "translateY(10px)" }}
								>
									{isReleased ? (
										<SpotifyLoginButton variant="dark" />
									) : (
										<WaitlistInput variant="dark" />
									)}
								</div>
							</div>
						</div>

						{/* Right: Full-height analysis panel - reveals with curtain wipe */}
						<div
							ref={panelRef}
							className="hero-panel pointer-events-auto relative hidden overflow-hidden xl:block"
							style={{ opacity: 0 }}
						>
							{/* Curtain wipe overlay (slides right to reveal) */}
							<div
								ref={panelCurtainRef}
								className="hero-panel-curtain pointer-events-none absolute inset-0 z-20"
								style={{ background: theme.bg }}
							/>

							<LandingPanel
								song={likedSong}
								albumArtUrl={albumArtUrl}
								artistImageUrl={artistImageUrl}
								onPrev={onPrev}
								onNext={onNext}
							/>
						</div>

						{/* Mobile: Panel (no scroll animation on mobile) */}
						<div className="pointer-events-auto relative min-h-screen xl:hidden">
							<LandingPanel
								song={likedSong}
								albumArtUrl={albumArtUrl}
								artistImageUrl={artistImageUrl}
								onPrev={onPrev}
								onNext={onNext}
							/>
						</div>
					</div>

					{/* Scroll indicator - fades out on first scroll */}
					<div
						ref={scrollIndicatorRef}
						className={`pointer-events-none absolute bottom-8 left-1/2 z-20 -translate-x-1/2 transition-opacity duration-1000 ${isHeroVisualReady ? "opacity-100" : "opacity-0"}`}
					>
						<div
							className="scroll-indicator flex flex-col items-center gap-2"
							style={{ color: theme.textOnPrimary }}
						>
							<span className="text-sm tracking-widest uppercase opacity-80">
								scroll to explore
							</span>
							<svg
								className="scroll-arrow h-6 w-6 opacity-60"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								strokeWidth={1.5}
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									d="M19 14l-7 7m0 0l-7-7m7 7V3"
								/>
							</svg>
						</div>
					</div>
				</div>
			</section>
		</>
	);
}
