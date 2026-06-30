import { Fragment, memo } from "react";
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
					className="flex items-baseline gap-3 self-end"
				>
					{MODES.map(({ value, label }, index) => {
						const isSelected = mode === value;
						// One opacity utility per state — emitting two (e.g. a base
						// opacity plus the disabled override) makes the winner depend on
						// stylesheet order rather than this array's order.
						const stateClasses = disabled
							? "theme-text-muted opacity-40 cursor-not-allowed"
							: isSelected
								? "theme-text opacity-100"
								: "theme-text-muted opacity-60 hover:opacity-90 cursor-pointer";
						return (
							<Fragment key={value}>
								{index > 0 && (
									<span
										aria-hidden="true"
										className="theme-text-muted text-xl font-extralight leading-none opacity-40"
										style={{ fontFamily: fonts.display }}
									>
										/
									</span>
								)}
								<button
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
										"py-1 text-2xl font-extralight leading-none transition-[opacity,color] duration-150 ease-out",
										stateClasses,
									].join(" ")}
									style={{ fontFamily: fonts.display }}
								>
									{label}
								</button>
							</Fragment>
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
