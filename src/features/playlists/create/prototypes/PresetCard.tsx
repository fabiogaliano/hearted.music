/**
 * Prototype shared atom — one one-tap preset card. Flat/bordered per
 * hearted-design (§5 materiality): square corners, 1px border, background-only
 * hover, no card shadow. Deliberately plain text buttons, not `Button card`
 * (that primitive is full-width/block; these sit in a horizontal row).
 */

import { fonts } from "@/lib/theme/fonts";
import type { PresetVM } from "./types";

interface PresetCardProps {
	preset: PresetVM;
	onSelect: (preset: PresetVM) => void;
}

export function PresetCard({ preset, onSelect }: PresetCardProps) {
	return (
		<button
			type="button"
			onClick={() => onSelect(preset)}
			className="theme-border-color theme-hover-surface flex min-w-[180px] flex-1 cursor-pointer flex-col items-start gap-1 border px-4 py-3 text-left transition-colors duration-150"
		>
			<span
				className="theme-text text-sm"
				style={{ fontFamily: fonts.display, fontWeight: 300 }}
			>
				{preset.label}
			</span>
			<span
				className="theme-text-muted text-xs leading-snug"
				style={{ fontFamily: fonts.body }}
			>
				{preset.description}
			</span>
		</button>
	);
}
