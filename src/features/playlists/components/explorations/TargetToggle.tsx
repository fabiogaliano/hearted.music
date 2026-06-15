import { CheckIcon, MinusIcon } from "@phosphor-icons/react";
import { fonts } from "@/lib/theme/fonts";

interface TargetToggleProps {
	isTarget: boolean;
	onToggle: () => void;
}

/**
 * Add to / remove from the matching set, as the shared membership pill — the same
 * quiet rounded surface pill the cover-flow caption uses, so the one action reads
 * the same on every surface. Once matching it shows "In matching" and swaps to
 * "Remove" on hover; not yet matching it's an "Add to matching" pill whose hover
 * fills solid accent, previewing the commitment. Rounded so it sits in the same
 * family as the genre chips beside it, and quiet so the masthead title leads —
 * accent stays sparing, per the gallery aesthetic.
 */
export function TargetToggle({ isTarget, onToggle }: TargetToggleProps) {
	if (isTarget) {
		return (
			<button
				type="button"
				onClick={onToggle}
				aria-pressed
				aria-label="Remove from matching"
				className="group/match theme-border-color relative inline-flex min-h-10 min-w-[150px] cursor-pointer items-center justify-center self-start rounded-full border bg-(--t-surface) px-4 text-[11px] tracking-[0.14em] text-(--t-text) uppercase transition-[color,border-color,background-color,transform] duration-150 hover:bg-(--t-surface-dim) active:scale-[0.96]"
				style={{ fontFamily: fonts.body }}
			>
				<span className="flex items-center gap-1.5 transition-opacity duration-150 group-hover/match:opacity-0 motion-reduce:transition-none">
					<CheckIcon size={13} weight="bold" aria-hidden />
					In matching
				</span>
				<span className="absolute inset-0 flex items-center justify-center gap-1.5 opacity-0 transition-opacity duration-150 group-hover/match:opacity-100 motion-reduce:transition-none">
					<MinusIcon size={13} weight="bold" aria-hidden />
					Remove
				</span>
			</button>
		);
	}
	return (
		<button
			type="button"
			onClick={onToggle}
			aria-pressed={false}
			className="theme-border-color inline-flex min-h-10 cursor-pointer items-center gap-1.5 self-start rounded-full border bg-(--t-surface) px-4 text-[11px] tracking-[0.14em] text-(--t-primary) uppercase transition-[color,border-color,background-color,transform] duration-150 hover:border-(--t-primary) hover:bg-(--t-primary) hover:text-(--t-text-on-primary) active:scale-[0.96]"
			style={{ fontFamily: fonts.body }}
		>
			<span aria-hidden="true">＋</span> Add to matching
		</button>
	);
}
