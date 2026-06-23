import { useCallback, useEffect, useRef, useState } from "react";
import { DRAG_STEP_PX, FLICK_PROJECT_MS } from "./coverFlowGeometry";

interface UseCoverFlowDragArgs {
	/** The committed (clamped) centre index. */
	clamped: number;
	max: number;
	onCenterChange: (next: number) => void;
	onActivate: () => void;
}

/**
 * Owns the imperative pointer/wheel drag interaction for one cover-flow shelf:
 * the wheel-to-step accumulator, the finger-tracking drag, and the flick-to-snap
 * release. Returns the stage ref to attach, the live drag state the geometry
 * renders against, a `step` mover for the arrow buttons, and `justDraggedRef` so
 * the click that fires on release can tell a drag apart from a real tap.
 */
export function useCoverFlowDrag({
	clamped,
	max,
	onCenterChange,
	onActivate,
}: UseCoverFlowDragArgs) {
	const stageRef = useRef<HTMLDivElement>(null);
	// `lastX/lastT` and `prevX/prevT` keep the final two pointer samples so release
	// velocity can be estimated for the flick projection.
	const dragRef = useRef<{
		x: number;
		moved: boolean;
		lastX: number;
		lastT: number;
		prevX: number;
		prevT: number;
	} | null>(null);
	// A drag that moved past the slop threshold sets this so the click it fires on
	// release doesn't also re-centre/open the sleeve under the finger.
	const justDraggedRef = useRef(false);
	// Fractional centre offset while a drag is live (covers follow the finger), and
	// whether a drag is in flight (suspends the per-sleeve snap transition).
	const [dragSteps, setDragSteps] = useState(0);
	const [dragging, setDragging] = useState(false);

	// The once-bound listeners below read interaction state through this ref so
	// they stay fresh without re-subscribing on every render.
	const latest = useRef({ clamped, max, onCenterChange, onActivate });
	latest.current = { clamped, max, onCenterChange, onActivate };

	const step = useCallback((dir: number) => {
		const { clamped, max, onCenterChange, onActivate } = latest.current;
		onActivate();
		onCenterChange(Math.max(0, Math.min(max, clamped + dir)));
	}, []);

	// Wheel needs a non-passive listener so it can preventDefault page scroll.
	// Pointer move/up are added only for the duration of a drag (on pointerdown,
	// off on pointerup) so the window isn't carrying drag listeners per shelf
	// while nothing's dragging. `step` is stable, so this binds once.
	useEffect(() => {
		const stage = stageRef.current;
		if (!stage) return;
		let acc = 0;
		let lock = false;
		const onWheel = (event: WheelEvent) => {
			const delta =
				Math.abs(event.deltaX) > Math.abs(event.deltaY)
					? event.deltaX
					: event.deltaY;
			if (!delta) return;
			event.preventDefault();
			latest.current.onActivate();
			acc += delta;
			if (lock) return;
			if (Math.abs(acc) > 26) {
				step(acc > 0 ? 1 : -1);
				acc = 0;
				lock = true;
				window.setTimeout(() => {
					lock = false;
				}, 240);
			}
		};
		const onMove = (event: PointerEvent) => {
			const drag = dragRef.current;
			if (!drag) return;
			const dx = event.clientX - drag.x;
			if (Math.abs(dx) > 6) drag.moved = true;
			drag.prevX = drag.lastX;
			drag.prevT = drag.lastT;
			drag.lastX = event.clientX;
			drag.lastT = performance.now();
			// Finger left (dx < 0) advances toward the next cover, so the centre rises.
			const { clamped, max } = latest.current;
			const next = -dx / DRAG_STEP_PX;
			setDragSteps(Math.max(-clamped, Math.min(max - clamped, next)));
		};
		const onUp = (event: PointerEvent) => {
			const drag = dragRef.current;
			dragRef.current = null;
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			setDragging(false);
			setDragSteps(0);
			if (!drag) return;
			justDraggedRef.current = drag.moved;
			const dx = event.clientX - drag.x;
			const dt = Math.max(1, drag.lastT - drag.prevT);
			const velocity = (drag.lastX - drag.prevX) / dt;
			// Project the exit velocity ahead, then snap to the nearest whole cover —
			// a long drag or a quick flick both round to multiple steps.
			const projected = dx + velocity * FLICK_PROJECT_MS;
			const { clamped, max, onCenterChange } = latest.current;
			const steps = Math.round(-projected / DRAG_STEP_PX);
			onCenterChange(Math.max(0, Math.min(max, clamped + steps)));
		};
		const onDown = (event: PointerEvent) => {
			const t = performance.now();
			dragRef.current = {
				x: event.clientX,
				moved: false,
				lastX: event.clientX,
				lastT: t,
				prevX: event.clientX,
				prevT: t,
			};
			latest.current.onActivate();
			setDragging(true);
			window.addEventListener("pointermove", onMove);
			window.addEventListener("pointerup", onUp);
		};
		stage.addEventListener("wheel", onWheel, { passive: false });
		stage.addEventListener("pointerdown", onDown);
		return () => {
			stage.removeEventListener("wheel", onWheel);
			stage.removeEventListener("pointerdown", onDown);
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		};
	}, [step]);

	return { stageRef, dragSteps, dragging, step, justDraggedRef };
}
