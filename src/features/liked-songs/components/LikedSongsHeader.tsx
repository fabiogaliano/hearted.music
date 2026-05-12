import type { LikedSongsStatsResult } from "@/lib/server/liked-songs.functions";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";

interface LikedSongsHeaderProps {
	stats: LikedSongsStatsResult | undefined;
	showSelectionUI: boolean;
	selectionMode: boolean;
	onEnterSelectionMode: () => void;
}

export function LikedSongsHeader({
	stats,
	showSelectionUI,
	selectionMode,
	onEnterSelectionMode,
}: LikedSongsHeaderProps) {
	const theme = useTheme();

	return (
		<div className="mb-8">
			<p
				className="text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				Your Music
			</p>
			<h1
				className="mt-3 text-5xl font-extralight"
				style={{ fontFamily: fonts.display, color: theme.text }}
			>
				Liked Songs
			</h1>

			<div className="mt-6 flex items-baseline gap-6">
				<span
					className="text-3xl font-extralight tabular-nums"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					{stats?.success ? stats.total : "—"}
				</span>
				<span
					className="text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					songs
				</span>
				<span
					className="text-sm"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					·
				</span>
				<span
					className="text-sm tabular-nums"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					{stats?.success ? stats.analyzed : "—"} analyzed
				</span>
				<span
					className="text-sm"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					·
				</span>
				<span
					className="text-sm tabular-nums"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					{stats?.success ? stats.pending : "—"} pending
				</span>
				{stats?.success && stats.locked > 0 && (
					<>
						<span
							className="text-sm"
							style={{ fontFamily: fonts.body, color: theme.textMuted }}
						>
							·
						</span>
						<span
							className="text-sm tabular-nums"
							style={{ fontFamily: fonts.body, color: theme.textMuted }}
						>
							{stats.locked} locked
						</span>
					</>
				)}
				{showSelectionUI &&
					stats?.success &&
					stats.locked > 0 &&
					!selectionMode && (
						<button
							type="button"
							onClick={onEnterSelectionMode}
							className="cursor-pointer rounded-full border px-3 py-1 text-xs tracking-wide uppercase transition-opacity hover:opacity-80"
							style={{
								fontFamily: fonts.body,
								borderColor: theme.border,
								color: theme.text,
								background: "transparent",
							}}
						>
							Unlock Songs
						</button>
					)}
			</div>
		</div>
	);
}
