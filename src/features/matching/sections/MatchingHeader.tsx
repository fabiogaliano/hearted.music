import { memo } from "react";
import { fonts } from "@/lib/theme/fonts";
import type { MatchingHeaderProps } from "../types";

export const MatchingHeader = memo(function MatchingHeader({
	currentIndex,
	totalSongs,
}: MatchingHeaderProps) {
	const progress = ((currentIndex + 1) / totalSongs) * 100;

	return (
		<div className="mb-8 flex items-center justify-between">
			<div>
				<p
					className="theme-text-muted text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
				>
					Matching
				</p>
				<h2
					className="theme-text mt-3 text-page-title font-extralight tracking-tight"
					style={{ fontFamily: fonts.display }}
				>
					{currentIndex + 1} of {totalSongs}
				</h2>
			</div>

			<div className="theme-border-bg h-1 w-32 overflow-hidden rounded-full">
				<div
					className="theme-text-muted-bg h-full transition-[width] duration-200"
					style={{ width: `${progress}%` }}
				/>
			</div>
		</div>
	);
});
