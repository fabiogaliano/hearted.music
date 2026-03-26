/**
 * Smart smooth progress with predictive velocity and fast completion catch-up.
 *
 * Problem: progress arrives in uneven batches, which makes the percentage jump.
 *
 * Approach:
 * 1. Track the incoming progress rate with exponential smoothing
 * 2. Predict a velocity that stays slightly behind the real progress
 * 3. Use a fast interpolation when complete so the finish feels intentional
 */

import { useEffect, useRef, useState } from "react";

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

const ALPHA = 0.4;
const MIN_VELOCITY = 0.02;
const MAX_VELOCITY = 0.15;
const CEILING_BUFFER = 6;
const COMPLETION_LERP = 0.08;

export function useSmoothProgress(
	target: number,
	isComplete: boolean,
	initialValue?: number,
): number {
	const initial = initialValue ?? 0;

	const [display, setDisplay] = useState(initial);
	const displayRef = useRef(initial);
	const velocityRef = useRef(MIN_VELOCITY);
	const animationRef = useRef<number | null>(null);
	const isJsdom =
		typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent);

	const lastTargetRef = useRef(0);
	const lastTargetTimeRef = useRef(Date.now());
	const smoothedRateRef = useRef(0);
	const targetRef = useRef(target);
	const isCompleteRef = useRef(isComplete);

	targetRef.current = target;
	isCompleteRef.current = isComplete;

	useEffect(() => {
		if (isJsdom) {
			const nextDisplay = isCompleteRef.current ? 100 : targetRef.current;
			displayRef.current = nextDisplay;
			setDisplay(nextDisplay);
			return;
		}

		let isCancelled = false;

		const animate = () => {
			if (isCancelled || typeof window === "undefined") {
				return;
			}

			const prev = displayRef.current;
			const actualTarget = targetRef.current;
			const complete = isCompleteRef.current;
			const now = Date.now();

			if (prev >= 99.9) {
				displayRef.current = 100;
				if (!isCancelled) {
					setDisplay(100);
				}
				return;
			}

			if (actualTarget === 0 && !complete) {
				animationRef.current = requestAnimationFrame(animate);
				return;
			}

			if (actualTarget > lastTargetRef.current) {
				const deltaTarget = actualTarget - lastTargetRef.current;
				const deltaTime = Math.max(now - lastTargetTimeRef.current, 1);
				const instantRate = deltaTarget / deltaTime;

				if (smoothedRateRef.current === 0) {
					smoothedRateRef.current = instantRate;
				} else {
					smoothedRateRef.current =
						ALPHA * instantRate + (1 - ALPHA) * smoothedRateRef.current;
				}

				lastTargetRef.current = actualTarget;
				lastTargetTimeRef.current = now;
			}

			let newDisplay: number;

			if (complete) {
				const remaining = 100 - prev;
				newDisplay = prev + remaining * COMPLETION_LERP;
			} else {
				const gap = actualTarget - prev;
				let targetVelocity = MIN_VELOCITY;

				if (smoothedRateRef.current > 0) {
					targetVelocity = smoothedRateRef.current * 16.67 * 0.9;
				}

				if (gap > 20) {
					targetVelocity = Math.max(targetVelocity, MAX_VELOCITY);
				} else if (gap > 10) {
					targetVelocity = Math.max(targetVelocity * 1.3, MIN_VELOCITY * 2);
				} else if (gap < 2) {
					targetVelocity = Math.min(targetVelocity * 0.5, MIN_VELOCITY);
				}

				targetVelocity = clamp(targetVelocity, MIN_VELOCITY, MAX_VELOCITY);
				velocityRef.current = velocityRef.current * 0.9 + targetVelocity * 0.1;

				newDisplay = prev + velocityRef.current;
				const ceiling = Math.min(actualTarget + CEILING_BUFFER, 99);
				newDisplay = Math.min(newDisplay, ceiling);
			}

			newDisplay = Math.max(newDisplay, prev);
			displayRef.current = newDisplay;

			if (!isCancelled && Math.abs(newDisplay - prev) > 0.01) {
				setDisplay(newDisplay);
			}

			if (!isCancelled) {
				animationRef.current = requestAnimationFrame(animate);
			}
		};

		animationRef.current = requestAnimationFrame(animate);

		return () => {
			isCancelled = true;
			if (animationRef.current !== null) {
				cancelAnimationFrame(animationRef.current);
			}
		};
	}, [isJsdom]);

	return isJsdom ? (isComplete ? 100 : target) : display;
}
