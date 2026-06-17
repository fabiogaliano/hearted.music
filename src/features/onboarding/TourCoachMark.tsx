import { useEffect, useState } from "react";
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
	useEffect(() => setShown(true), []);

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
							className="theme-text text-[15px] leading-relaxed text-pretty opacity-90"
							style={{ fontFamily: fonts.body }}
						>
							{line}
						</p>
					))}
				</div>
				<div className="mt-6 flex justify-center">
					<Button
						variant="primary"
						onClick={onAction}
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
