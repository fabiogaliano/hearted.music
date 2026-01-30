/**
 * Reusable animated wrapper for onboarding steps.
 * Handles enter/exit transitions with reduced motion support.
 *
 * Animation style: "Editorial Fade" — pure opacity transitions
 * like turning a page in a high-end magazine. Confident, unhurried.
 */

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

interface AnimatedStepProps {
	children: ReactNode;
	/** Unique key for AnimatePresence tracking */
	stepKey: string;
}

/** Smooth ease-out for elegant entrances */
const EASE_OUT = [0, 0, 0.2, 1] as const;
/** Subtle ease-in for clean exits */
const EASE_IN = [0.4, 0, 1, 1] as const;

const stepVariants = {
	initial: { opacity: 0 },
	animate: {
		opacity: 1,
		transition: { duration: 0.35, ease: EASE_OUT },
	},
	exit: {
		opacity: 0,
		transition: { duration: 0.25, ease: EASE_IN },
	},
};

export function AnimatedStep({ children, stepKey }: AnimatedStepProps) {
	const shouldReduceMotion = useReducedMotion();

	if (shouldReduceMotion) {
		// Key still needed for AnimatePresence tracking even without animation
		return (
			<div key={stepKey} data-step={stepKey}>
				{children}
			</div>
		);
	}

	return (
		<motion.div
			key={stepKey}
			data-step={stepKey}
			variants={stepVariants}
			initial="initial"
			animate="animate"
			exit="exit"
			style={{ willChange: "opacity" }}
		>
			{children}
		</motion.div>
	);
}

export type { AnimatedStepProps };
