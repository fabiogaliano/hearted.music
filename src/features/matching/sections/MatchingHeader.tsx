import { memo } from "react";
import { fonts } from "@/lib/theme/fonts";
import { MatchModeToggle } from "../components/MatchModeToggle";
import type { MatchingHeaderProps } from "../types";

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

				{/* Focus moves to document.body after route navigation because
				    pendingComponent remounts the route boundary mid-transition. No
				    restoration is implemented — this is the accepted behavior (MSR-30
				    option b); see MatchingHeader.test.tsx for coverage. */}
				<MatchModeToggle
					mode={mode}
					disabled={disabled}
					onModeChange={onModeChange}
				/>
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
