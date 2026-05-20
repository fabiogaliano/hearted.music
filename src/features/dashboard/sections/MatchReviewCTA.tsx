/** Only rendered when reviewCount > 0. */
import { ArrowRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { fonts } from "@/lib/theme/fonts";
import { FanSpreadAlbumArt } from "../components/FanSpreadAlbumArt";
import type { MatchPreview } from "../types";

interface MatchReviewCTAProps {
	reviewCount: number;
	matchPreviews: MatchPreview[];
}

export function MatchReviewCTA({
	reviewCount,
	matchPreviews,
}: MatchReviewCTAProps) {
	if (reviewCount === 0) return null;

	return (
		<Link
			to="/match"
			className="theme-surface-bg group -mx-4 mb-10 block px-4 py-6 transition-colors"
		>
			<p
				className="theme-text-muted mb-2 text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				Ready to match
			</p>
			<div className="flex items-center justify-between">
				<h3
					className="theme-text text-3xl font-extralight"
					style={{ fontFamily: fonts.display }}
				>
					{reviewCount} new {reviewCount === 1 ? "song" : "songs"}
				</h3>
				<div className="flex items-center gap-8">
					<FanSpreadAlbumArt images={matchPreviews} />
					<span
						className="theme-text-muted text-sm transition-transform group-hover:translate-x-1"
						style={{ fontFamily: fonts.body }}
					>
						Start <ArrowRightIcon size={14} />
					</span>
				</div>
			</div>
		</Link>
	);
}
