import { InfoIcon } from "@phosphor-icons/react";
import {
	useCallback,
	useEffect,
	useEffectEvent,
	useId,
	useRef,
	useState,
} from "react";
import { fonts } from "@/lib/theme/fonts";
import {
	type DescriptionExample,
	DescriptionExamplesShuffle,
} from "./DescriptionExamplesShuffle";

interface IntentExamplesPopoverProps {
	examples: readonly DescriptionExample[];
	/** Fill the intent draft (description + genres) from the picked example. */
	onPick: (description: string, genres: readonly string[]) => void;
}

// Match InfoTip's hover-intent timing so the two "(i)" affordances feel identical:
// ~400ms to open so a passing cursor doesn't trigger it, a short grace on close so
// moving from the icon onto the card (or tabbing between its buttons) doesn't drop it.
const OPEN_DELAY = 400;
const CLOSE_DELAY = 150;

/**
 * An "(i)" beside the Matching intent label that explains what the intent is and
 * offers the example shuffler to fill it — the production counterpart to
 * onboarding's inline pick-to-fill, shuffling across the whole pool rather than one
 * playlist's set. Mirrors InfoTip: same hover/focus reveal and sharp-cornered card,
 * but it holds interactive controls, so blur closes on a delay (not instantly) to
 * survive tabbing between Shuffle and Pick.
 */
export function IntentExamplesPopover({
	examples,
	onPick,
}: IntentExamplesPopoverProps) {
	const [open, setOpen] = useState(false);
	const openTimer = useRef<number | null>(null);
	const closeTimer = useRef<number | null>(null);
	const id = useId();

	const clearTimers = useCallback(() => {
		if (openTimer.current) window.clearTimeout(openTimer.current);
		if (closeTimer.current) window.clearTimeout(closeTimer.current);
		openTimer.current = null;
		closeTimer.current = null;
	}, []);

	const scheduleOpen = useCallback(() => {
		clearTimers();
		openTimer.current = window.setTimeout(() => setOpen(true), OPEN_DELAY);
	}, [clearTimers]);
	const scheduleClose = useCallback(() => {
		clearTimers();
		closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY);
	}, [clearTimers]);
	const setNow = useCallback(
		(next: boolean) => {
			clearTimers();
			setOpen(next);
		},
		[clearTimers],
	);

	// Clear any pending timer if the tip unmounts mid-delay.
	useEffect(() => clearTimers, [clearTimers]);

	// useEffectEvent keeps the capture-phase listener from re-binding on every parent
	// render — it re-runs only when `open` flips, while still reading the latest state.
	const closeOnEscape = useEffectEvent(() => setNow(false));
	// Escape closes the popover, not the whole panel: a capture-phase listener runs
	// ahead of the panel's bubble-phase document handler, and stopPropagation keeps
	// the keystroke from reaching it.
	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				closeOnEscape();
			}
		};
		document.addEventListener("keydown", onKey, true);
		return () => document.removeEventListener("keydown", onKey, true);
	}, [open]);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a hover-region wrapper bridging the trigger and its card, not a control itself — the focusable trigger button inside owns the real semantics.
		<span
			className="relative inline-flex"
			onPointerEnter={scheduleOpen}
			onPointerLeave={scheduleClose}
			onFocus={() => setNow(true)}
			onBlur={scheduleClose}
		>
			<button
				type="button"
				aria-label="About matching intent"
				aria-describedby={open ? id : undefined}
				className="grid size-5 cursor-help place-items-center rounded-full text-(--t-text-muted) transition-colors duration-150 hover:text-(--t-text)"
				style={{ color: open ? "var(--t-text)" : undefined }}
			>
				<InfoIcon size={14} aria-hidden />
			</button>
			{open && (
				<div className="absolute top-full left-0 z-40 pt-1.5">
					{/* theme-bg (not the surface tone) so the generator card's legend
					    notch, which masks itself with --t-bg, stays seamless. Sharp
					    corners to match the Genres "(i)". */}
					<div
						id={id}
						role="tooltip"
						className="theme-bg w-[min(27rem,84vw)] p-3"
						style={{
							boxShadow:
								"0 10px 30px -14px color-mix(in srgb, var(--t-text) 38%, transparent)",
						}}
					>
						<p
							className="mb-3 text-xs leading-snug text-pretty"
							style={{ fontFamily: fonts.body, color: "var(--t-text-muted)" }}
						>
							Your liked songs get matched to this description.
						</p>
						<DescriptionExamplesShuffle
							examples={examples}
							onPick={(description, genres) => {
								onPick(description, genres);
								setNow(false);
							}}
						/>
					</div>
				</div>
			)}
		</span>
	);
}
