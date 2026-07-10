/**
 * Prototype — Direction 3: empty-state takeover. Replaces the entire config
 * surface with a full-bleed choice screen the first time a user lands with
 * nothing configured — the boldest direction, betting that most users want a
 * fast starting point rather than an empty form. "Start from scratch" is an
 * explicit escape hatch so the takeover never traps a user who wants to
 * configure by hand.
 */

import { fonts } from "@/lib/theme/fonts";
import { PresetCard } from "./PresetCard";
import type { PresetVM } from "./types";

interface PresetEmptyStateTakeoverProps {
	presets: PresetVM[];
	onSelect: (preset: PresetVM) => void;
	onStartFromScratch: () => void;
}

export function PresetEmptyStateTakeover({
	presets,
	onSelect,
	onStartFromScratch,
}: PresetEmptyStateTakeoverProps) {
	return (
		<div className="theme-border-color flex flex-col items-center gap-8 border px-10 py-16 text-center">
			<div className="flex flex-col gap-2">
				<h2
					className="theme-text text-2xl leading-tight font-extralight text-balance"
					style={{ fontFamily: fonts.display }}
				>
					Where should we start?
				</h2>
				<p
					className="theme-text-muted text-sm"
					style={{ fontFamily: fonts.body }}
				>
					Pick a starting point, or build your own from scratch.
				</p>
			</div>

			<div className="grid w-full max-w-xl grid-cols-2 gap-3">
				{presets.map((preset) => (
					<PresetCard key={preset.id} preset={preset} onSelect={onSelect} />
				))}
			</div>

			<button
				type="button"
				onClick={onStartFromScratch}
				className="theme-text-muted cursor-pointer text-xs underline underline-offset-2 transition-opacity duration-150 hover:opacity-70"
				style={{ fontFamily: fonts.body }}
			>
				Start from scratch
			</button>
		</div>
	);
}
