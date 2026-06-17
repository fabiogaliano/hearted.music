import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { fonts } from "@/lib/theme/fonts";

interface TourCoachMarkProps {
	/** Optional heading. Omit for a body-only card — a single concept line that
	 *  carries itself and needs no title above it. */
	title?: string;
	/** One paragraph per entry — kept as separate lines so each beat of the
	 *  explanation lands on its own. */
	body: readonly string[];
	actionLabel: string;
	onAction: () => void;
	/** Frosted-glass blur (px) on the dim — matches SpotlightOverlay's default. */
	blur?: number;
}

/**
 * A modal coach-mark for the onboarding rehearsal: dims + frosts the whole page
 * and floats one explanatory card with a single action. Used to teach a concept
 * ("what's a matching intent?") before handing control back — distinct from the
 * inline UI so it reads as guidance, not chrome. Portaled to body above the panel
 * and the spotlight; production never mounts it.
 */
export function TourCoachMark({
	title,
	body,
	actionLabel,
	onAction,
	blur = 6,
}: TourCoachMarkProps) {
	// Mount-in transition: the card settles up + fades so it arrives as a beat of
	// its own rather than snapping over the dimmed page.
	const [shown, setShown] = useState(false);
	const dialogRef = useRef<HTMLDivElement>(null);
	const actedRef = useRef(false);
	const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Keep the latest onAction reachable from the once-mounted keydown effect below,
	// so Escape never fires a stale handler captured on the first render.
	const onActionRef = useRef(onAction);
	useEffect(() => {
		onActionRef.current = onAction;
	});

	// Play the exit (reverse of the enter) before handing control back, so the card
	// leaves on a beat instead of vanishing. Self-contained: callers still just
	// mount/unmount the component and pass onAction. Stable (only refs + setShown),
	// so the keydown effect below can depend on it without re-running each render.
	const handleAction = useCallback(() => {
		if (actedRef.current) return;
		actedRef.current = true;
		setShown(false);
		exitTimer.current = setTimeout(() => onActionRef.current(), 220);
	}, []);

	useEffect(() => setShown(true), []);

	// Clear the pending exit hand-off if we unmount before it fires.
	useEffect(
		() => () => {
			if (exitTimer.current) clearTimeout(exitTimer.current);
		},
		[],
	);

	// Honour the aria-modal contract: move focus into the dialog, trap Tab, and let
	// Escape dismiss (Escape runs the same single action as the button).
	useEffect(() => {
		const node = dialogRef.current;
		if (!node) return;
		const previouslyFocused = document.activeElement as HTMLElement | null;
		node.querySelector<HTMLElement>("button")?.focus();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				handleAction();
				return;
			}
			if (e.key !== "Tab") return;
			const focusables = node.querySelectorAll<HTMLElement>(
				'button, [href], [tabindex]:not([tabindex="-1"])',
			);
			if (focusables.length === 0) return;
			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
			previouslyFocused?.focus?.();
		};
	}, [handleAction]);

	if (typeof document === "undefined") return null;

	const scrim = "color-mix(in srgb, var(--t-text) 44%, transparent)";

	return createPortal(
		<div
			className={`fixed inset-0 z-[65] flex items-center justify-center p-6 transition-opacity duration-300 ease-[var(--ease-out-quart)] motion-reduce:transition-none ${shown ? "opacity-100" : "opacity-0"}`}
		>
			<div
				aria-hidden="true"
				className="absolute inset-0"
				style={{
					background: scrim,
					...(blur > 0
						? {
								backdropFilter: `blur(${blur}px)`,
								WebkitBackdropFilter: `blur(${blur}px)`,
							}
						: {}),
				}}
			/>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-label={title ?? body[0]}
				className={`relative w-full max-w-[400px] px-7 py-7 text-center transition-transform duration-300 ease-[var(--ease-out-quart)] motion-reduce:transition-none ${shown ? "translate-y-0 scale-100" : "translate-y-1.5 scale-[0.97]"}`}
				style={{
					background: "var(--t-surface)",
					color: "var(--t-text)",
					boxShadow:
						"0 24px 60px -24px color-mix(in srgb, var(--t-text) 55%, transparent)",
				}}
			>
				{title && (
					<h3
						className="theme-text text-[22px] leading-snug font-light tracking-tight text-balance"
						style={{ fontFamily: fonts.display }}
					>
						{title}
					</h3>
				)}
				<div className={`${title ? "mt-3 " : ""}flex flex-col gap-2`}>
					{body.map((line) => (
						<p
							key={line}
							className="theme-text text-[15px] leading-relaxed text-balance opacity-90"
							style={{ fontFamily: fonts.body }}
						>
							{line}
						</p>
					))}
				</div>
				<div className="mt-6 flex justify-center">
					<Button
						variant="primary"
						onClick={handleAction}
						style={{ fontFamily: fonts.body }}
					>
						{actionLabel}
					</Button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
