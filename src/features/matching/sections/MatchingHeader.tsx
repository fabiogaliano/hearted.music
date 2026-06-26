import { memo } from "react";
import { fonts } from "@/lib/theme/fonts";
import type { MatchingHeaderProps, MatchViewMode } from "../types";

const MODES: { value: MatchViewMode; label: string }[] = [
	{ value: "song", label: "Song" },
	{ value: "playlist", label: "Playlist" },
];

export const MatchingHeader = memo(function MatchingHeader({
	currentIndex,
	totalSongs,
	mode,
	disabled = false,
	onModeChange,
}: MatchingHeaderProps) {
	const progress = ((currentIndex + 1) / totalSongs) * 100;

	return (
		<div className="mb-[clamp(1rem,4dvh,3rem)]">
			<div className="mb-[clamp(0.5rem,2dvh,1.25rem)] flex items-end justify-between gap-6">
				<div>
					<p
						className="theme-text-muted text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Matching
					</p>
					<h2
						className="theme-text mt-[clamp(0.25rem,1.5dvh,0.75rem)] text-[clamp(1.5rem,3.4dvh,1.875rem)] font-extralight tabular-nums leading-none"
						style={{ fontFamily: fonts.display }}
					>
						<span>{currentIndex + 1}</span>
						<span className="theme-text-muted opacity-60"> / {totalSongs}</span>
					</h2>
				</div>

				{/* aria-pressed on each button (not tablist/tab) because selecting a mode
				    triggers a navigation rather than switching a visible panel in-place. */}
				{/* biome-ignore lint/a11y/useSemanticElements: navigation toggle, not a form-control group; aria-pressed buttons with a group label is the correct pattern */}
				<div
					role="group"
					aria-label="View mode"
					className="flex items-center gap-px self-end pb-1"
				>
					{MODES.map(({ value, label }) => {
						const isSelected = mode === value;
						return (
							<button
								key={value}
								type="button"
								aria-pressed={isSelected}
								disabled={disabled}
								onClick={() => {
									// Guard: never navigate when mode is already current (A3).
									if (isSelected) return;
									// Focus moves to document.body after route navigation because
									// pendingComponent remounts the route boundary mid-transition.
									// No restoration is implemented — this is the accepted behavior
									// (MSR-30 option b); see MatchingHeader.test.tsx for coverage.
									onModeChange(value);
								}}
								className={[
									"px-3 py-1 text-xs tracking-widest uppercase transition-opacity",
									"first:rounded-l last:rounded-r",
									"theme-border-color border",
									isSelected
										? "theme-primary-bg theme-text-on-primary font-medium"
										: "theme-surface-bg theme-text-muted hover:opacity-80",
									disabled ? "cursor-not-allowed opacity-40" : "",
								]
									.filter(Boolean)
									.join(" ")}
								style={{ fontFamily: fonts.body }}
							>
								{label}
							</button>
						);
					})}
				</div>
			</div>

			<div className="theme-border-bg relative h-px w-full overflow-hidden">
				<div
					className="theme-primary-bg absolute inset-y-0 left-0 transition-[width] duration-500 ease-out"
					style={{ width: `${progress}%` }}
				/>
			</div>
		</div>
	);
});
