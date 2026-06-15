import { InfoIcon } from "@phosphor-icons/react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { fonts } from "@/lib/theme/fonts";

interface InfoTipProps {
	/** Accessible name for the trigger button. */
	label: string;
	children: ReactNode;
}

// Hover-intent timing: ~400ms to open so a cursor sweeping past doesn't trigger
// it (NNG's 0.3–0.5s "is the user actually pointing at this?" window), and a
// short close grace so a momentary pointer slip between icon and card doesn't
// make it flicker. Keyboard focus opens instantly — tabbing to it is deliberate.
const OPEN_DELAY = 400;
const CLOSE_DELAY = 150;

/**
 * A small "(i)" affordance that reveals a short explanatory popover — for
 * optional, nice-to-know context that shouldn't live on screen as permanent body
 * copy. Opens on hover (after a short intent delay) and on keyboard focus (WCAG
 * 1.4.13: content on hover or focus), dismissible with Escape. The card is its
 * own surface so it reads on any background; the gap below the icon is a
 * transparent hoverable bridge so moving onto the card doesn't dismiss it.
 */
export function InfoTip({ label, children }: InfoTipProps) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLSpanElement>(null);
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

	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setNow(false);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, setNow]);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a hover-region wrapper that bridges the trigger button and its card, not a control itself — the focusable trigger lives inside and owns the real semantics.
		<span
			ref={ref}
			className="relative inline-flex"
			onPointerEnter={scheduleOpen}
			onPointerLeave={scheduleClose}
			onFocus={() => setNow(true)}
			onBlur={() => setNow(false)}
		>
			<button
				type="button"
				aria-label={label}
				aria-describedby={open ? id : undefined}
				className="grid size-5 cursor-help place-items-center rounded-full text-(--t-text-muted) transition-colors duration-150 hover:text-(--t-text)"
				style={{ color: open ? "var(--t-text)" : undefined }}
			>
				<InfoIcon size={14} aria-hidden />
			</button>
			{open && (
				<div className="absolute top-full left-0 z-40 pt-1.5">
					<div
						id={id}
						role="tooltip"
						className="theme-surface-bg theme-border-color w-[min(16rem,72vw)] border p-3 text-xs leading-snug text-pretty"
						style={{
							fontFamily: fonts.body,
							color: "var(--t-text-muted)",
							boxShadow:
								"0 8px 24px -12px color-mix(in srgb, var(--t-text) 30%, transparent)",
						}}
					>
						{children}
					</div>
				</div>
			)}
		</span>
	);
}
