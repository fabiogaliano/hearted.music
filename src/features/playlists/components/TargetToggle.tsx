import { CheckIcon, MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { fonts } from "@/lib/theme/fonts";
import "./playlist-ui.css";

interface TargetToggleProps {
	isTarget: boolean;
	onToggle: () => void;
	/** Pulse a theme-colored glow to draw the eye — the onboarding "add it" beat. */
	pulse?: boolean;
}

/**
 * Add to / remove from the matching set. The label swaps instantly between states —
 * no slide or crossfade, those ghosted two texts over each other — so the only
 * motion is the pill's colour transitioning. Not matching it's an accent
 * "Add to matching" whose hover fills solid accent, previewing the commitment; once
 * matching it reads "In matching" and swaps to "Remove" on hover.
 *
 * The "Remove" hover is suppressed on the very hover that performed the add: right
 * after clicking "Add to matching" the cursor is still on the pill, and flipping
 * straight to "Remove" (then back to "In matching" the instant you leave) reads as a
 * twitchy dare-to-undo. So the add-click arms a suppression flag that holds
 * "In matching" until the pointer actually leaves — only a fresh hover afterwards
 * reveals "Remove". Touch has no hover, so it's left out (the pill stays informational
 * and a tap toggles directly). A fixed min width keeps the pill from resizing as the
 * shorter labels swap in.
 */
export function TargetToggle({
	isTarget,
	onToggle,
	pulse = false,
}: TargetToggleProps) {
	const [hovering, setHovering] = useState(false);
	const [removeSuppressed, setRemoveSuppressed] = useState(false);

	const showRemove = isTarget && hovering && !removeSuppressed;

	return (
		<button
			type="button"
			aria-pressed={isTarget}
			aria-label={isTarget ? "Remove from matching" : "Add to matching"}
			onClick={() => {
				if (!isTarget) setRemoveSuppressed(true);
				onToggle();
			}}
			onPointerEnter={(event) => {
				if (event.pointerType !== "touch") setHovering(true);
			}}
			onPointerLeave={(event) => {
				if (event.pointerType === "touch") return;
				setHovering(false);
				setRemoveSuppressed(false);
			}}
			className={`theme-border-color inline-flex min-h-10 min-w-[150px] cursor-pointer items-center justify-center gap-1.5 self-start rounded-full border px-4 text-[11px] tracking-[0.14em] uppercase transition-[color,border-color,background-color,transform] duration-200 ease-[var(--ease-out-quart)] active:scale-[0.96] motion-reduce:transition-none ${
				pulse ? "xpl-pulse" : ""
			} ${
				isTarget
					? "bg-(--t-surface) text-(--t-text) hover:bg-(--t-surface-dim)"
					: "bg-(--t-surface) text-(--t-primary) hover:border-(--t-primary) hover:bg-(--t-primary) hover:text-(--t-text-on-primary)"
			}`}
			style={{ fontFamily: fonts.body }}
		>
			{!isTarget && (
				<>
					<PlusIcon size={13} weight="bold" aria-hidden />
					Add to matching
				</>
			)}
			{isTarget && !showRemove && (
				<>
					<CheckIcon size={13} weight="bold" aria-hidden />
					In matching
				</>
			)}
			{showRemove && (
				<>
					<MinusIcon size={13} weight="bold" aria-hidden />
					Remove
				</>
			)}
		</button>
	);
}
