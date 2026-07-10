/**
 * Prototype — Direction 1: a row of preset cards above the config surface.
 * Shown only while the config is empty (no intent, no genres, no filters);
 * picking one seeds genre pills / intent and the row disappears, since its
 * job is done once the user has a starting point.
 */

import { fonts } from "@/lib/theme/fonts";
import { PresetCard } from "./PresetCard";
import type { PresetVM } from "./types";

interface PresetCardsRowProps {
	presets: PresetVM[];
	onSelect: (preset: PresetVM) => void;
}

export function PresetCardsRow({ presets, onSelect }: PresetCardsRowProps) {
	return (
		<div className="mb-8 flex flex-col gap-3">
			<span
				className="theme-text-muted text-[11px] tracking-[0.2em] uppercase"
				style={{ fontFamily: fonts.body }}
			>
				Quick start
			</span>
			<div className="flex flex-wrap gap-3">
				{presets.map((preset) => (
					<PresetCard key={preset.id} preset={preset} onSelect={onSelect} />
				))}
			</div>
		</div>
	);
}
