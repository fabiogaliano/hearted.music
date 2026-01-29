import { useCallback, useEffect, useRef, useState } from "react";

import { type ThemeConfig } from "@/lib/theme/types";
import { extractHue, getPastelColor } from "@/lib/utils/color";

// Mix of musical notes and tiny hearts - music + feelings
const PARTICLE_SYMBOLS = ["♪", "♥", "♫", "♥", "♩", "♥"];

export interface AnimatedHeartProps {
	theme: ThemeConfig;
	shouldAutoPlay?: boolean;
	/** Delay in ms before auto-play triggers (default 1500) */
	autoPlayDelayMs?: number;
}

export function AnimatedHeart({
	theme,
	shouldAutoPlay,
	autoPlayDelayMs = 1500,
}: AnimatedHeartProps) {
	const [isHovered, setIsHovered] = useState(false);
	const [isAnimating, setIsAnimating] = useState(false);
	const containerRef = useRef<HTMLSpanElement>(null);
	const heartRef = useRef<HTMLSpanElement>(null);
	const animationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	// Get soft pastel color from theme hue
	const themeHue = extractHue(theme.primary);
	const pastelColor = getPastelColor(themeHue);

	// Create floating notes & hearts that drift upward
	const createParticles = useCallback(() => {
		const container = containerRef.current;
		if (!container) return;

		const particleCount = 6;

		for (let i = 0; i < particleCount; i++) {
			const particle = document.createElement("span");
			particle.textContent = PARTICLE_SYMBOLS[i % PARTICLE_SYMBOLS.length];
			particle.style.cssText = `
				position: absolute;
				font-size: ${PARTICLE_SYMBOLS[i % PARTICLE_SYMBOLS.length] === "♥" ? "8px" : "10px"};
				pointer-events: none;
				left: 50%;
				top: 50%;
				color: ${pastelColor};
				text-shadow: 0 1px 2px rgba(0,0,0,0.1);
			`;
			container.appendChild(particle);

			// Random angle for burst direction, biased upward
			const angle = -90 + (Math.random() - 0.5) * 140; // wider arc for notes
			const distance = 25 + Math.random() * 18;
			const rad = (angle * Math.PI) / 180;
			const tx = Math.cos(rad) * distance;
			const ty = Math.sin(rad) * distance;
			// Slight rotation for playful feel
			const rotation = (Math.random() - 0.5) * 40;

			// Animate each particle with slight delay for stagger effect
			particle.animate(
				[
					{
						transform: "translate(-50%, -50%) scale(0) rotate(0deg)",
						opacity: 1,
					},
					{
						transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(1.2) rotate(${rotation}deg)`,
						opacity: 1,
						offset: 0.25,
					},
					{
						transform: `translate(calc(-50% + ${tx * 1.6}px), calc(-50% + ${ty * 3}px)) scale(0.6) rotate(${rotation * 2}deg)`,
						opacity: 0,
					},
				],
				{
					duration: 900 + Math.random() * 400,
					easing: "cubic-bezier(0.16, 1, 0.3, 1)",
					delay: i * 50,
					fill: "forwards",
				},
			).onfinish = () => particle.remove();
		}
	}, [pastelColor]);

	// Create expanding ring effect
	const createRing = useCallback(() => {
		const container = containerRef.current;
		if (!container) return;

		const ring = document.createElement("span");
		ring.style.cssText = `
			position: absolute;
			left: 50%;
			top: 50%;
			width: 10px;
			height: 10px;
			border-radius: 50%;
			border: 2px solid ${pastelColor};
			pointer-events: none;
			transform: translate(-50%, -50%);
		`;
		container.appendChild(ring);

		ring.animate(
			[
				{ transform: "translate(-50%, -50%) scale(0.5)", opacity: 1 },
				{ transform: "translate(-50%, -50%) scale(2.5)", opacity: 0 },
			],
			{
				duration: 400,
				easing: "cubic-bezier(0.16, 1, 0.3, 1)",
				fill: "forwards",
			},
		).onfinish = () => ring.remove();
	}, [pastelColor]);

	const triggerAnimation = useCallback(() => {
		// Set animating state for color change
		setIsAnimating(true);

		const heart = heartRef.current;
		if (heart) {
			// Cancel any existing animation and start fresh (handles rapid clicks)
			heart.getAnimations().forEach((anim) => anim.cancel());

			// Use Web Animations API - doesn't conflict with React's reconciliation
			heart.animate(
				[
					{ transform: "scale(1)", offset: 0 },
					{ transform: "scale(1.3)", offset: 0.4 }, // Peak at 40% like original CSS
					{ transform: "scale(1)", offset: 1 },
				],
				{
					duration: 600,
					easing: "cubic-bezier(0.17, 0.89, 0.32, 1.28)",
				},
			);
		}

		// Trigger particle effects
		createRing();
		createParticles();

		// Clear existing timeout
		if (animationTimeoutRef.current) {
			clearTimeout(animationTimeoutRef.current);
		}

		// Reset color after animation
		animationTimeoutRef.current = setTimeout(() => {
			setIsAnimating(false);
		}, 600);
	}, [createParticles, createRing]);

	// Auto-play effect
	useEffect(() => {
		if (!shouldAutoPlay) return;

		const timeouts: NodeJS.Timeout[] = [];
		const trigger = (delay: number) => {
			const t = setTimeout(() => triggerAnimation(), delay);
			timeouts.push(t);
		};

		// Single click (delayed to wait for text fade-in)
		trigger(autoPlayDelayMs);

		return () => timeouts.forEach(clearTimeout);
	}, [shouldAutoPlay, triggerAnimation, autoPlayDelayMs]);

	// Cleanup animation timeout on unmount
	useEffect(() => {
		return () => {
			if (animationTimeoutRef.current) {
				clearTimeout(animationTimeoutRef.current);
			}
		};
	}, []);

	// Use pointer events for faster response than click
	const handlePointerDown = useCallback(
		(e: React.PointerEvent) => {
			// Prevent text selection from double-click
			e.preventDefault();
			triggerAnimation();
		},
		[triggerAnimation],
	);

	const isFilled = isHovered || isAnimating;

	return (
		<span
			ref={containerRef}
			className="pointer-events-auto relative inline-block"
			style={{ userSelect: "none", WebkitUserSelect: "none" }}
		>
			<style>{`
				.heart-clickable {
					user-select: none;
					-webkit-user-select: none;
					-webkit-touch-callout: none;
					touch-action: manipulation;
				}
			`}</style>
			<span
				ref={heartRef}
				role="button"
				tabIndex={0}
				onPointerDown={handlePointerDown}
				onMouseEnter={() => setIsHovered(true)}
				onMouseLeave={() => setIsHovered(false)}
				className="heart-clickable relative inline-block cursor-pointer transition-colors"
				style={{
					background: "none",
					border: "none",
					padding: 0,
					color: pastelColor,
				}}
				aria-label="Heart animation"
			>
				{isFilled ? "♥" : "♡"}
			</span>
		</span>
	);
}
