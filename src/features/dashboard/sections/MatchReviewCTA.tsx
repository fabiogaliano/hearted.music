/** Only rendered when reviewCount > 0. */
import { ArrowRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { MatchViewMode } from "@/features/matching/types";
import { fonts } from "@/lib/theme/fonts";
import { FanSpreadAlbumArt } from "../components/FanSpreadAlbumArt";
import type { MatchPreview } from "../types";

interface MatchReviewCTAProps {
	reviewCount: number;
	matchPreviews: MatchPreview[];
	/** Orientation the count reflects — the CTA links and reads in this mode (A2). */
	orientation: MatchViewMode;
}

export function MatchReviewCTA({
	reviewCount,
	matchPreviews,
	orientation,
}: MatchReviewCTAProps) {
	if (reviewCount === 0) return null;

	const isPlaylist = orientation === "playlist";
	// Playlist mode is the canonical bare /match URL; song mode uses ?mode=song.
	const search = isPlaylist ? {} : ({ mode: "song" } as const);
	const noun = isPlaylist
		? reviewCount === 1
			? "playlist"
			: "playlists"
		: reviewCount === 1
			? "song"
			: "songs";

	return (
		<Link
			to="/match"
			search={search}
			// The old hover paired a border-brighten with hover:opacity-95, because the
			// brightening hairline alone was too quiet to register. Temperature carries
			// the hover on its own now, so the opacity dip goes: it faded the album art
			// and headline along with the plane, dimming the content to signal the
			// container.
			className="surface-raised surface-raised-hover squircle focus-edge group -mx-4 mb-10 block rounded-[14px] px-4 py-6 motion-safe:active:scale-[0.99]"
		>
			<p
				className="theme-text-muted mb-2 text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				Ready to match
			</p>
			<div className="flex items-center justify-between gap-6">
				<h3
					className="theme-text text-3xl font-extralight text-balance"
					style={{ fontFamily: fonts.display }}
				>
					{reviewCount} {noun} to match
				</h3>
				<div className="flex items-center gap-8">
					<FanSpreadAlbumArt images={matchPreviews} />
					<span
						className="theme-text-muted inline-flex items-center gap-1.5 text-sm transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-1"
						style={{ fontFamily: fonts.body }}
					>
						Start
						<ArrowRightIcon size={14} weight="regular" />
					</span>
				</div>
			</div>
		</Link>
	);
}
