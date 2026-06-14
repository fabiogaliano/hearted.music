import { fonts } from "@/lib/theme/fonts";

interface TargetToggleProps {
	isTarget: boolean;
	onToggle: () => void;
}

/**
 * Add to / remove from the matching set. Square by house materiality — filled
 * accent when the playlist isn't matching yet (the call to action), quiet
 * outline once it is.
 */
export function TargetToggle({ isTarget, onToggle }: TargetToggleProps) {
	return (
		<button
			type="button"
			onClick={onToggle}
			aria-pressed={isTarget}
			className={`inline-flex min-h-11 items-center gap-2 self-start px-[18px] py-[11px] text-xs tracking-[0.1em] uppercase transition-[transform,background-color,border-color,color] duration-150 active:scale-[0.98] ${
				isTarget
					? "theme-text theme-border-color border hover:border-(--t-text-muted)"
					: "theme-primary-action border border-transparent hover:opacity-90"
			}`}
			style={{ fontFamily: fonts.body }}
		>
			<span className="text-[15px] leading-none" aria-hidden="true">
				{isTarget ? "✓" : "+"}
			</span>
			{isTarget ? "In matching" : "Add to matching"}
		</button>
	);
}
