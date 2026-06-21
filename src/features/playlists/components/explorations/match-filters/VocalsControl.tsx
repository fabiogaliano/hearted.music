/**
 * VocalsControl — manual Female / Male selector.
 *
 * Renders two toggle buttons. Selecting one sets vocalGender; removing the
 * active selection uses the X button on the selected chip — no separate Clear
 * button (decisions §7). Fully keyboard operable: Tab to focus, Enter/Space to
 * select, the X chip is its own focusable button.
 */

import { XIcon } from "@phosphor-icons/react";
import { vocalGenderLabel } from "@/lib/domains/taste/match-filters/labels";
import { normalizeMatchFilters } from "@/lib/domains/taste/match-filters/normalizers";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { fonts } from "@/lib/theme/fonts";
import "../playlist-explorations.css";

export interface VocalsControlProps {
	filters: PlaylistMatchFiltersV1;
	onFiltersChange: (next: PlaylistMatchFiltersV1) => void;
	disabled?: boolean;
	/** True while a save is in flight — freezes chip removal (see §7 vs save). */
	isSaving?: boolean;
}

const VOCALS_OPTIONS: Array<{ value: "female" | "male" }> = [
	{ value: "female" },
	{ value: "male" },
];

/**
 * The selected value renders as a chip with an X for clearing — no separate
 * Clear button per decisions §7. When neither is selected both toggle buttons
 * are visible and selectable.
 */
export function VocalsControl({
	filters,
	onFiltersChange,
	disabled = false,
	isSaving = false,
}: VocalsControlProps) {
	const active = filters.vocalGender;

	const select = (value: "female" | "male") => {
		const next = normalizeMatchFilters({ ...filters, vocalGender: value });
		onFiltersChange(next);
	};

	const clear = () => {
		// Frozen during a pending save so the removal isn't lost on reconcile.
		if (isSaving) return;
		const { vocalGender: _dropped, ...rest } = filters;
		onFiltersChange(normalizeMatchFilters({ ...rest }));
	};

	return (
		<div style={{ fontFamily: fonts.body }}>
			<div className="text-[11px] tracking-[0.08em] uppercase theme-text-muted mb-2">
				Vocals
			</div>

			{active ? (
				/* Selected state: one chip with remove X, no extra clear button. */
				<span
					className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 theme-border-color xpl-chip-enter"
					style={{
						background: "color-mix(in srgb, var(--t-primary) 12%, transparent)",
					}}
				>
					<span
						className="text-sm leading-none tracking-[0.02em]"
						style={{ color: "var(--t-primary)" }}
					>
						{vocalGenderLabel(active)}
					</span>
					<button
						type="button"
						onClick={clear}
						disabled={isSaving}
						aria-label={`Remove ${vocalGenderLabel(active)} vocals filter`}
						className="grid size-[16px] shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 transition-[color] duration-150 hover:theme-text active:scale-[0.9] disabled:cursor-default disabled:opacity-50"
						style={{ color: "var(--t-primary)" }}
					>
						<XIcon size={9} weight="bold" aria-hidden />
					</button>
				</span>
			) : (
				/* Unselected state: both options as <fieldset> buttons (semantic group). */
				<fieldset className="m-0 border-0 p-0">
					<legend className="sr-only">Vocals</legend>
					<div className="flex gap-2">
						{VOCALS_OPTIONS.map(({ value }) => (
							<button
								key={value}
								type="button"
								onClick={() => select(value)}
								disabled={disabled}
								aria-pressed={false}
								className="border px-4 py-1.5 text-sm theme-border-color theme-text-muted cursor-pointer transition-[background-color,color,border-color] duration-150 hover:bg-(--t-surface) hover:theme-text active:scale-[0.98] disabled:opacity-50"
							>
								{vocalGenderLabel(value)}
							</button>
						))}
					</div>
				</fieldset>
			)}
		</div>
	);
}
