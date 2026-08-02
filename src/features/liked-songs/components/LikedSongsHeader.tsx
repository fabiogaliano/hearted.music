/**
 * The page masthead: title, count, and the Unlock entry point.
 *
 * Titles float on the page background — the studio does the same with its
 * playlist-name field — so the first thing that lands as a solid object is the
 * library panel below. The filter/search controls that used to live here moved
 * into that panel (LikedSongsToolbar), where they sit with the rows they act on.
 */

import { Button } from "@/components/ui/Button";
import type { LikedSongsStatsResult } from "@/lib/server/liked-songs.functions";
import { fonts } from "@/lib/theme/fonts";

interface LikedSongsHeaderProps {
	stats: LikedSongsStatsResult | undefined;
	lockedSongCount: number;
	showSelectionUI: boolean;
	selectionMode: boolean;
	onEnterSelectionMode: () => void;
	isWalkthrough: boolean;
}

export function LikedSongsHeader({
	stats,
	lockedSongCount,
	showSelectionUI,
	selectionMode,
	onEnterSelectionMode,
	isWalkthrough,
}: LikedSongsHeaderProps) {
	const total = stats?.success === true ? stats.total : null;

	const showUnlockAction =
		showSelectionUI && lockedSongCount > 0 && !selectionMode;

	return (
		<header className="mb-6">
			<div className="flex items-end justify-between gap-6">
				<h1
					className="theme-text flex items-baseline gap-4 font-extralight tracking-tight leading-[0.95]"
					style={{ fontFamily: fonts.display }}
					aria-label={
						isWalkthrough
							? "Liked Songs, preview"
							: total != null
								? `Liked Songs, ${total} total`
								: "Liked Songs"
					}
				>
					<span className="text-page-title">Liked Songs</span>
					<span
						aria-hidden="true"
						className={`theme-text-muted text-3xl opacity-60 ${
							isWalkthrough ? "" : "tabular-nums"
						}`}
					>
						{isWalkthrough ? "preview" : (total ?? "—")}
					</span>
				</h1>

				{showUnlockAction && (
					<Button
						variant="surface"
						onClick={onEnterSelectionMode}
						className="hidden @[900px]:inline-flex"
						style={{ fontFamily: fonts.body }}
					>
						Unlock Songs
					</Button>
				)}
			</div>
		</header>
	);
}
