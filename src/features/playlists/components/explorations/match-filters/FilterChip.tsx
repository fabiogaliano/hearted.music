import { XIcon } from "@phosphor-icons/react";
import { fonts } from "@/lib/theme/fonts";

interface FilterChipProps {
	/** Compact value-only label — never filter-name-prefixed. */
	label: string;
	/** When provided the chip shows a remove X and is keyboard-operable. */
	onRemove?: () => void;
	/**
	 * Override the remove button's aria-label with a type-qualified string.
	 * Falls back to `Remove ${label} filter` when omitted.
	 * Callers should supply e.g. "Remove English language filter" so screen readers
	 * announce the filter type, not just the value.
	 */
	removeAriaLabel?: string;
}

/**
 * A single compact active-filter chip: value-only label + optional remove action.
 * Styled to read lighter than the genre chips (which use solid accent fill) —
 * these are informational indicators, not picked tags, so they use a surface-dim
 * background with primary text rather than a full primary fill.
 */
export function FilterChip({
	label,
	onRemove,
	removeAriaLabel,
}: FilterChipProps) {
	return (
		<span
			className="inline-flex items-center gap-1 rounded-full border bg-(--t-surface-dim) px-2.5 py-0.5 whitespace-nowrap theme-border-color"
			style={{ fontFamily: fonts.body }}
		>
			<span className="text-[11px] leading-none tracking-[0.04em] theme-text">
				{label}
			</span>
			{onRemove && (
				<button
					type="button"
					onClick={onRemove}
					aria-label={removeAriaLabel ?? `Remove ${label} filter`}
					className="-mr-0.5 grid size-[16px] shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 theme-text-muted transition-[color,opacity] duration-150 hover:theme-text active:scale-[0.9]"
				>
					<XIcon size={9} weight="bold" aria-hidden />
				</button>
			)}
		</span>
	);
}
