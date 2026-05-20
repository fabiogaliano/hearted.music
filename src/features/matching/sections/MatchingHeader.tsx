import { memo } from "react";
import { fonts } from "@/lib/theme/fonts";
import type { MatchingHeaderProps } from "../types";

export const MatchingHeader = memo(function MatchingHeader({
	currentIndex,
	totalSongs,
}: MatchingHeaderProps) {
	const progress = ((currentIndex + 1) / totalSongs) * 100;

	return (
		<div className="mb-12">
			<div className="mb-5 flex items-end justify-between gap-6">
				<div>
					<p
						className="theme-text-muted text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Matching
					</p>
					<h2
						className="theme-text mt-3 text-3xl font-extralight tabular-nums leading-none"
						style={{ fontFamily: fonts.display }}
					>
						<span>{currentIndex + 1}</span>
						<span className="theme-text-muted opacity-60"> / {totalSongs}</span>
					</h2>
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
