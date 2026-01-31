/**
 * Reusable animated wrapper for onboarding steps.
 * Handles enter/exit transitions with reduced motion support.
 *
 * Animation style: "Editorial Fade" — pure opacity transitions
 * like turning a page in a high-end magazine. Confident, unhurried.
 */

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

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
		return <div data-step={stepKey}>{children}</div>;
	}

	// Note: AnimatePresence tracks identity via key on THIS component in parent JSX,
	// not via key on internal elements. Parent must use <AnimatedStep key={step}>.
	return (
		<motion.div
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
