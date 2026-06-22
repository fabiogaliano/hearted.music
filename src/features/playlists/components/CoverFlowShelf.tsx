import {
	type CSSProperties,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { fonts } from "@/lib/theme/fonts";
import { Cover } from "./Cover";
import { ShelfCaption } from "./ShelfCaption";
import type { PlaylistSummary } from "./types";
import "./playlist-ui.css";

const prefersReduced = () =>
	typeof window !== "undefined" &&
	window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Cover-flow stage geometry, tuned by eye and named so the per-sleeve math below
 * reads as intent rather than a wall of magic numbers. Distances are in steps
 * from the centered sleeve.
 */
const SLEEVE = {
	/** px the first neighbour sits off-centre… */
	shift: 140,
	/** …plus this per extra step out. */
	gap: 58,
	/** deg neighbours angle back toward the stage. */
	rotation: 44,
	/** px each step recedes along Z. */
	depth: 72,
	/** per-step shrink (gentler when motion is reduced). */
	scaleStep: 0.12,
	scaleStepReduced: 0.08,
	minScale: 0.64,
	/** per-step fade. */
	opacityStep: 0.24,
	/** sleeves more than this many steps out aren't drawn. */
	cullBeyond: 4,
	/** …and beyond this they stop catching pointer events. */
	interactiveWithin: 3,
} as const;

// px the centred sleeve travels per one step of drag — equal to the first
// neighbour's shift, so the centred cover tracks the finger 1:1 while dragging.
const DRAG_STEP_PX = SLEEVE.shift;
// Release momentum: project the finger's exit velocity this far ahead before
// snapping, so a fast flick advances several covers, not just the dragged one.
const FLICK_PROJECT_MS = 90;

// `offset` may be fractional while a drag is in flight, so x / ry / z interpolate
// continuously across the first step instead of popping from centre (x=0) to the
// first neighbour's `shift`. At integer offsets the math reduces to the discrete
// resting geometry, so a settled flow looks exactly as before.
function sleeveStyle(
	offset: number,
	reduce: boolean,
	dragging: boolean,
): CSSProperties {
	const distance = Math.abs(offset);
	const sign = Math.sign(offset);
	const hidden = distance > SLEEVE.cullBeyond;
	const x =
		distance <= 1
			? offset * SLEEVE.shift
			: sign * (SLEEVE.shift + (distance - 1) * SLEEVE.gap);
	const ry = reduce ? 0 : -(distance <= 1 ? offset : sign) * SLEEVE.rotation;
	const tz = reduce ? 0 : -distance * SLEEVE.depth;
	const scale = Math.max(
		SLEEVE.minScale,
		1 - distance * (reduce ? SLEEVE.scaleStepReduced : SLEEVE.scaleStep),
	);
	return {
		transform: `translateX(${x}px) translateZ(${tz}px) rotateY(${ry}deg) scale(${scale})`,
		opacity: hidden ? 0 : Math.max(0, 1 - distance * SLEEVE.opacityStep),
		visibility: hidden ? "hidden" : "visible",
		zIndex: 100 - Math.round(distance),
		pointerEvents: distance > SLEEVE.interactiveWithin ? "none" : "auto",
		transformStyle: "preserve-3d",
		transformOrigin: "50% 100%",
		willChange: "transform, opacity",
		// No transition while the finger drives the covers — they must track 1:1.
		// Restored on release so the snap to the nearest cover animates.
		transition:
			reduce || dragging
				? "none"
				: "transform 520ms var(--ease-out-expo), opacity 380ms ease",
	};
}

function dropShadow(isCenter: boolean): string {
	return isCenter
		? "0 30px 60px -24px color-mix(in srgb, var(--t-text) 65%, transparent)"
		: "0 24px 44px -22px color-mix(in srgb, var(--t-text) 60%, transparent)";
}

interface CoverFlowShelfProps {
	label: string;
	playlists: PlaylistSummary[];
	center: number;
	onCenterChange: (next: number) => void;
	onActivate: () => void;
	onOpen: (id: string) => void;
	onAdd: (id: string) => void;
	onRemove: (id: string) => void;
	/** Id of a just-added playlist whose sleeve should fly in rather than pop. */
	enterId?: string | null;
	/**
	 * The chrome around the (fixed) stage. `plain` keeps the label left + arrows
	 * right. `chapter` rides the label on a hairline rule with the count floated to
	 * its far end (no arrow buttons — sleeves are navigated by click / wheel / drag
	 * / keys). The sleeve geometry is identical in both.
	 */
	chrome?: "plain" | "chapter";
	/**
	 * Empty-state copy, overridable so the onboarding preview can teach the concept
	 * ("what's a matching candidate?") while production keeps the terse default.
	 */
	emptyTitle?: string;
	emptyBody?: string;
	/** Action rendered below the empty-state copy — the onboarding "Next" button
	 *  that advances the walkthrough from the concept step. */
	emptyAction?: ReactNode;
}

/**
 * One cover-flow shelf: the centered sleeve sits front-and-large, neighbors
 * angle back and recede. Browse by wheel, drag, the ‹ › arrows, or click a
 * neighbor to center it (click the centered sleeve to open). reduced-motion
 * keeps every control but drops the 3-D rotation/recession.
 */
export function CoverFlowShelf({
	label,
	playlists,
	center,
	onCenterChange,
	onActivate,
	onOpen,
	onAdd,
	onRemove,
	enterId,
	chrome = "plain",
	emptyTitle = "No matching candidates yet",
	emptyBody = "Add playlists from your library below — each one's description is how your liked songs find their homes.",
	emptyAction,
}: CoverFlowShelfProps) {
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
	const reduce = prefersReduced();
	// The name is the open link; hovering the centered cover OR the name drifts the
	// same arrow, so the two — in separate subtrees — share one hover state.
	const [openHover, setOpenHover] = useState(false);
	// Fractional centre offset while a drag is live (covers follow the finger), and
	// whether a drag is in flight (suspends the per-sleeve snap transition).
	const [dragSteps, setDragSteps] = useState(0);
	const [dragging, setDragging] = useState(false);
	const max = Math.max(0, playlists.length - 1);
	const clamped = Math.max(0, Math.min(center, max));
	const centered = playlists[clamped];
	// Fractional centre the geometry renders against: the committed centre shifted
	// by the live drag, kept within the real range so the ends don't overscroll.
	const renderCenter = Math.max(0, Math.min(max, clamped + dragSteps));

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

	const onSleeveClick = (index: number, id: string) => {
		// onUp clears dragRef before this click fires, so the just-dragged flag (not
		// the now-null ref) is what tells a drag-release apart from a real tap.
		if (justDraggedRef.current) {
			justDraggedRef.current = false;
			return;
		}
		onActivate();
		if (index === clamped) onOpen(id);
		else onCenterChange(index);
	};

	const arrowButton = (dir: -1 | 1) => (
		<button
			key={dir}
			type="button"
			aria-label={dir < 0 ? "Previous" : "Next"}
			onClick={() => step(dir)}
			className="theme-text-muted theme-border-color grid size-[34px] place-items-center rounded-full border text-lg leading-none transition-[color,border-color,transform] duration-150 hover:border-(--t-text-muted) hover:text-(--t-text) active:scale-[0.92]"
		>
			{dir < 0 ? "‹" : "›"}
		</button>
	);

	const arrowPair = (
		<div className="flex gap-1.5">
			{arrowButton(-1)}
			{arrowButton(1)}
		</div>
	);

	const labelEl = (
		<span
			className="theme-text-muted flex items-baseline gap-2.5 text-xs tracking-[0.2em] uppercase"
			style={{ fontFamily: fonts.body }}
		>
			{label} <span className="tabular-nums">{playlists.length}</span>
		</span>
	);

	const stage = (
		<div
			ref={stageRef}
			className="relative mt-3 h-[220px] cursor-grab overflow-x-clip overflow-y-visible active:cursor-grabbing md:h-[268px]"
			style={{
				perspective: "1500px",
				perspectiveOrigin: "50% 46%",
				touchAction: "pan-y",
			}}
		>
			{playlists.length === 0 ? (
				<p
					className="theme-text-muted absolute inset-0 grid place-items-center text-[13px]"
					style={{ fontFamily: fonts.body }}
				>
					Nothing here yet.
				</p>
			) : (
				playlists.map((playlist, index) => {
					// Geometry follows the fractional drag centre; the centred-cover
					// treatment (no dim, hover-linked open) tracks the committed centre so
					// it doesn't flicker mid-drag.
					const offset = index - renderCenter;
					const isCenter = index === clamped;
					const isEntering = !reduce && playlist.id === enterId;
					return (
						<button
							key={playlist.id}
							type="button"
							tabIndex={-1}
							aria-label={playlist.name}
							onClick={() => onSleeveClick(index, playlist.id)}
							onPointerEnter={isCenter ? () => setOpenHover(true) : undefined}
							onPointerLeave={isCenter ? () => setOpenHover(false) : undefined}
							className="group/sleeve absolute top-6 left-1/2 -ml-[84px] block size-[168px] cursor-pointer border-0 bg-transparent p-0 md:-ml-[108px] md:size-[216px]"
							style={sleeveStyle(offset, reduce, dragging)}
						>
							<div
								className="relative h-full w-full transition-transform duration-100 ease-out group-active/sleeve:scale-[0.96] motion-reduce:transition-none"
								style={{ boxShadow: dropShadow(isCenter) }}
							>
								<div
									className={
										isEntering
											? "xpl-sleeve-enter h-full w-full"
											: "h-full w-full"
									}
								>
									<Cover
										src={playlist.imageUrl}
										size="fill"
										style={
											isCenter
												? undefined
												: { filter: "brightness(0.82) saturate(0.9)" }
										}
									/>
								</div>
							</div>
						</button>
					);
				})
			)}
		</div>
	);

	return (
		<section className="mt-8">
			{chrome === "chapter" ? (
				<div className="flex items-center gap-4 px-1">
					<span
						className="theme-text-muted text-xs tracking-[0.2em] uppercase"
						style={{ fontFamily: fonts.body }}
					>
						{label}
					</span>
					<div className="theme-border-color h-px flex-1 self-center border-t" />
					<span
						className="theme-text-muted text-xs tabular-nums"
						style={{ fontFamily: fonts.body }}
					>
						{playlists.length}
					</span>
				</div>
			) : (
				<div className="flex items-center justify-between px-1">
					{labelEl}
					{arrowPair}
				</div>
			)}

			{playlists.length === 0 ? (
				// Empty: skip the tall 3-D stage (a big void reads as broken) for a
				// compact invitation — a ghost sleeve where covers will land, pointing
				// the eye down to the rail it's filled from.
				<div
					data-tour="concept"
					className="mt-3 flex min-h-[220px] flex-col items-center justify-center gap-5 text-center md:min-h-[260px]"
				>
					<div
						aria-hidden="true"
						className="theme-border-color theme-text-muted grid size-[120px] place-items-center border border-dashed text-4xl"
					>
						♫
					</div>
					<div className="flex flex-col items-center gap-1.5">
						<p
							className="theme-text text-lg font-light"
							style={{ fontFamily: fonts.display }}
						>
							{emptyTitle}
						</p>
						<p
							className="theme-text-muted max-w-[46ch] text-[13px] text-pretty"
							style={{ fontFamily: fonts.body }}
						>
							{emptyBody}
						</p>
					</div>
					{emptyAction ? <div className="mt-1">{emptyAction}</div> : null}
				</div>
			) : (
				<>
					{stage}

					<div
						className="mt-4 flex min-h-[116px] items-center justify-center px-1"
						aria-live="polite"
					>
						{centered ? (
							// Keyed to the centred id so the settle animation re-fires on each
							// navigation; the covers' own glide is untouched.
							<div key={centered.id} className="xpl-caption-enter w-full">
								<ShelfCaption
									playlist={centered}
									onOpen={onOpen}
									onAdd={onAdd}
									onRemove={onRemove}
									openActive={openHover}
									onOpenHoverChange={setOpenHover}
								/>
							</div>
						) : null}
					</div>
				</>
			)}
		</section>
	);
}
