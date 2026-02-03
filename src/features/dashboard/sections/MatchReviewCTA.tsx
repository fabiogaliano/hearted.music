/** Only rendered when reviewCount > 0. */
import { Link } from "@tanstack/react-router";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { fonts } from "@/lib/theme/fonts";
import type { MatchPreview } from "../types";
import { FanSpreadAlbumArt } from "../components/FanSpreadAlbumArt";

interface MatchReviewCTAProps {
	reviewCount: number;
	matchPreviews: MatchPreview[];
}

export function MatchReviewCTA({
	reviewCount,
	matchPreviews,
}: MatchReviewCTAProps) {
	const theme = useTheme();
	if (reviewCount === 0) return null;

	return (
		<Link
			to="/match"
			className="group -mx-4 mb-10 block px-4 py-6 transition-colors"
			style={{ background: theme.surface }}
		>
			<p
				className="mb-2 text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				Ready to match
			</p>
			<div className="flex items-center justify-between">
				<h3
					className="text-3xl font-extralight"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					{reviewCount} new {reviewCount === 1 ? "song" : "songs"}
				</h3>
				<div className="flex items-center gap-8">
					<FanSpreadAlbumArt images={matchPreviews} />
					<span
						className="text-sm transition-transform group-hover:translate-x-1"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						Start →
					</span>
				</div>
			</div>
		</Link>
	);
}

export default MatchReviewCTA;
