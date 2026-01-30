/**
 * Wrapper for staggered children animations within a step.
 * Each direct child will animate in sequence.
 *
 * Animation style: "Whisper" — almost imperceptible reveals.
 * Content simply materializes without drawing attention to itself.
 */

import type { ReactNode } from "react";
import { Children, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";

interface StaggeredContentProps {
	children: ReactNode;
	/** Delay between each child animation (seconds) */
	staggerDelay?: number;
	/** Initial delay before first child animates (seconds) */
	initialDelay?: number;
	/** CSS classes for the container (e.g., grid layout) */
	className?: string;
	/** ARIA role for the container */
	role?: string;
	/** ARIA label for the container */
	"aria-label"?: string;
}

/** Ultra smooth, barely perceptible acceleration */
const EASE_SILK = [0.4, 0, 0.2, 1] as const;

/** Default timing for staggered reveals */
const DEFAULT_STAGGER_DELAY = 0.04;
const DEFAULT_INITIAL_DELAY = 0.1;

const itemVariants = {
	initial: { opacity: 0 },
	animate: {
		opacity: 1,
		transition: { duration: 0.5, ease: EASE_SILK },
	},
};

export function StaggeredContent({
	children,
	staggerDelay: staggerDelayOverride,
	initialDelay: initialDelayOverride,
	className,
	role,
	"aria-label": ariaLabel,
}: StaggeredContentProps) {
	const shouldReduceMotion = useReducedMotion();

	const staggerDelay = staggerDelayOverride ?? DEFAULT_STAGGER_DELAY;
	const initialDelay = initialDelayOverride ?? DEFAULT_INITIAL_DELAY;

	const containerVariants = useMemo(
		() => ({
			initial: {},
			animate: {
				transition: {
					staggerChildren: staggerDelay,
					delayChildren: initialDelay,
				},
			},
		}),
		[staggerDelay, initialDelay],
	);

	if (shouldReduceMotion) {
		return (
			<div className={className} role={role} aria-label={ariaLabel}>
				{children}
			</div>
		);
	}

	return (
		<motion.div
			className={className}
			role={role}
			aria-label={ariaLabel}
			variants={containerVariants}
			initial="initial"
			animate="animate"
		>
			{Children.map(children, (child, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: Static list of children without stable IDs
				<motion.div key={`stagger-${index}`} variants={itemVariants}>
					{child}
				</motion.div>
			))}
		</motion.div>
	);
}

export type { StaggeredContentProps };
