import { Button } from "@/components/ui/Button";
import type { LikedSongsStatsResult } from "@/lib/server/liked-songs.functions";
import { fonts } from "@/lib/theme/fonts";

interface LikedSongsHeaderProps {
	stats: LikedSongsStatsResult | undefined;
	lockedSongCount: number;
	showSelectionUI: boolean;
	selectionMode: boolean;
	onEnterSelectionMode: () => void;
}

export function LikedSongsHeader({
	stats,
	lockedSongCount,
	showSelectionUI,
	selectionMode,
	onEnterSelectionMode,
}: LikedSongsHeaderProps) {
	return (
		<div className="mb-8">
			<p
				className="theme-text-muted text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				Your Music
			</p>
			<h1
				className="theme-text mt-3 text-page-title font-extralight tracking-tight"
				style={{ fontFamily: fonts.display }}
			>
				Liked Songs
			</h1>

			<div className="mt-6 flex items-baseline gap-6">
				<span
					className="theme-text text-3xl font-extralight tabular-nums"
					style={{ fontFamily: fonts.display }}
				>
					{stats?.success ? stats.total : "—"}
				</span>
				<span
					className="theme-text-muted text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
				>
					songs
				</span>
				<span
					className="theme-text-muted text-sm"
					style={{ fontFamily: fonts.body }}
				>
					·
				</span>
				<span
					className="theme-text-muted text-sm tabular-nums"
					style={{ fontFamily: fonts.body }}
				>
					{stats?.success ? stats.analyzed : "—"} analyzed
				</span>
				<span
					className="theme-text-muted text-sm"
					style={{ fontFamily: fonts.body }}
				>
					·
				</span>
				<span
					className="theme-text-muted text-sm tabular-nums"
					style={{ fontFamily: fonts.body }}
				>
					{stats?.success ? stats.pending : "—"} pending
				</span>
				{lockedSongCount > 0 && (
					<>
						<span
							className="theme-text-muted text-sm"
							style={{ fontFamily: fonts.body }}
						>
							·
						</span>
						<span
							className="theme-text-muted text-sm tabular-nums"
							style={{ fontFamily: fonts.body }}
						>
							{lockedSongCount} locked
						</span>
					</>
				)}
				{showSelectionUI && lockedSongCount > 0 && !selectionMode && (
					<Button
						variant="surface"
						onClick={onEnterSelectionMode}
						className="ml-auto"
						style={{ fontFamily: fonts.body }}
					>
						Unlock Songs
					</Button>
				)}
			</div>
		</div>
	);
}
