import { memo } from "react";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import type { MatchingHeaderProps } from "../types";

export const MatchingHeader = memo(function MatchingHeader({
	currentIndex,
	totalSongs,
}: MatchingHeaderProps) {
	const theme = useTheme();
	const progress = ((currentIndex + 1) / totalSongs) * 100;

	return (
		<div className="mb-8 flex items-center justify-between">
			<div>
				<p
					className="text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Matching
				</p>
				<h2
					className="mt-2 text-4xl font-extralight"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					{currentIndex + 1} of {totalSongs}
				</h2>
			</div>

			<div
				className="h-1 w-32 overflow-hidden rounded-full"
				style={{ background: theme.border }}
			>
				<div
					className="h-full transition-[width] duration-200"
					style={{
						background: theme.text,
						width: `${progress}%`,
					}}
				/>
			</div>
		</div>
	);
});
