/**
 * Prototype — Direction 2: preset chips inside the config area itself,
 * sitting directly above the genre picker (mirrors GenrePillsPicker's own
 * quick-pick chip row styling — `gp-opt` — so it reads as "more of the same
 * control" rather than a separate feature). Lower-commitment than a card
 * row: no description, just a label, for users who want a nudge without a
 * new visual section.
 */

import { fonts } from "@/lib/theme/fonts";
import type { PresetVM } from "./types";

interface PresetChipsProps {
	presets: PresetVM[];
	onSelect: (preset: PresetVM) => void;
}

export function PresetChips({ presets, onSelect }: PresetChipsProps) {
	return (
		<div className="flex flex-col gap-2">
			<span
				className="theme-text-muted text-[11px] font-medium uppercase tracking-[0.18em]"
				style={{ fontFamily: fonts.body }}
			>
				Or start from
			</span>
			<div className="flex flex-wrap gap-2">
				{presets.map((preset) => (
					<button
						key={preset.id}
						type="button"
						onClick={() => onSelect(preset)}
						className="theme-border-color theme-hover-surface cursor-pointer border border-dashed px-3 py-1.5 text-xs transition-colors duration-150"
						style={{ fontFamily: fonts.body }}
					>
						{preset.label}
					</button>
				))}
			</div>
		</div>
	);
}
