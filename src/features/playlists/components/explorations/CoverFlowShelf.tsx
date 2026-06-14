import {
	type CSSProperties,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { fonts } from "@/lib/theme/fonts";
import { Cover } from "./Cover";
import { ShelfCaption } from "./ShelfCaption";
import type { PlaylistSummary } from "./types";
import "./playlist-explorations.css";

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

function sleeveStyle(offset: number, reduce: boolean): CSSProperties {
	const distance = Math.abs(offset);
	const sign = Math.sign(offset);
	const isCenter = offset === 0;
	const hidden = distance > SLEEVE.cullBeyond;
	const x = isCenter ? 0 : sign * (SLEEVE.shift + (distance - 1) * SLEEVE.gap);
	const ry = isCenter || reduce ? 0 : -sign * SLEEVE.rotation;
	const tz = reduce ? 0 : -distance * SLEEVE.depth;
	const scale = isCenter
		? 1
		: Math.max(
				SLEEVE.minScale,
				1 - distance * (reduce ? SLEEVE.scaleStepReduced : SLEEVE.scaleStep),
			);
	return {
		transform: `translateX(${x}px) translateZ(${tz}px) rotateY(${ry}deg) scale(${scale})`,
		opacity: hidden ? 0 : Math.max(0, 1 - distance * SLEEVE.opacityStep),
		visibility: hidden ? "hidden" : "visible",
		zIndex: 100 - distance,
		pointerEvents: distance > SLEEVE.interactiveWithin ? "none" : "auto",
		transformStyle: "preserve-3d",
		transformOrigin: "50% 100%",
		willChange: "transform, opacity",
		transition: reduce
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
	/**
	 * The chrome around the (fixed) stage. `plain` keeps the label left + arrows
	 * right. `chapter` rides the label on a hairline rule with the count floated to
	 * its far end (no arrow buttons — sleeves are navigated by click / wheel / drag
	 * / keys). The sleeve geometry is identical in both.
	 */
	chrome?: "plain" | "chapter";
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
	chrome = "plain",
}: CoverFlowShelfProps) {
	const stageRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef<{ x: number; moved: boolean } | null>(null);
	const reduce = prefersReduced();
	// The name is the open link; hovering the centered cover OR the name drifts the
	// same arrow, so the two — in separate subtrees — share one hover state.
	const [openHover, setOpenHover] = useState(false);
	const max = Math.max(0, playlists.length - 1);
	const clamped = Math.max(0, Math.min(center, max));
	const centered = playlists[clamped];

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
			if (Math.abs(event.clientX - drag.x) > 6) drag.moved = true;
		};
		const onUp = (event: PointerEvent) => {
			const drag = dragRef.current;
			dragRef.current = null;
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			if (!drag) return;
			const dx = event.clientX - drag.x;
			if (Math.abs(dx) > 44) step(dx < 0 ? 1 : -1);
		};
		const onDown = (event: PointerEvent) => {
			dragRef.current = { x: event.clientX, moved: false };
			latest.current.onActivate();
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
		if (dragRef.current?.moved) return;
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
					const offset = index - clamped;
					const isCenter = offset === 0;
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
							style={sleeveStyle(offset, reduce)}
						>
							<div
								className="relative h-full w-full transition-transform duration-100 ease-out group-active/sleeve:scale-[0.96] motion-reduce:transition-none"
								style={{ boxShadow: dropShadow(isCenter) }}
							>
								<Cover
									src={playlist.imageUrl}
									size="fill"
									className="text-5xl"
									style={
										isCenter
											? undefined
											: { filter: "brightness(0.82) saturate(0.9)" }
									}
								/>
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
		</section>
	);
}
