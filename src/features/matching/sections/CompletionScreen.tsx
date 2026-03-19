import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import type { CompletionScreenProps } from "../types";

export function CompletionScreen({
	stats,
	songs,
	onExit,
}: CompletionScreenProps) {
	const theme = useTheme();

	return (
		<div className="max-w-4xl">
			<div className="mb-8 flex items-start justify-between">
				<div>
					<p
						className="text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						Session Complete
					</p>
					<h2
						className="mt-2 text-4xl font-extralight"
						style={{ fontFamily: fonts.display, color: theme.text }}
					>
						All matched
					</h2>
				</div>
				<div
					className="flex items-center gap-2 text-xs"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					<span className="flex items-center gap-2">
						<span
							className="h-1.5 w-1.5 rounded-full"
							style={{ background: theme.text }}
						/>
						Just now
					</span>
				</div>
			</div>

			<div className="mb-10 h-px" style={{ background: theme.border }} />

			<div className="mb-10 grid grid-cols-3 gap-8">
				<div>
					<p
						className="text-4xl font-extralight tabular-nums"
						style={{ fontFamily: fonts.display, color: theme.text }}
					>
						{stats.totalSongs}
					</p>
					<p
						className="mt-1 text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						Songs reviewed
					</p>
				</div>
				<div>
					<p
						className="text-4xl font-extralight tabular-nums"
						style={{ fontFamily: fonts.display, color: theme.text }}
					>
						{stats.totalAdditions}
					</p>
					<p
						className="mt-1 text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						Playlist additions
					</p>
				</div>
				<div>
					<p
						className="text-4xl font-extralight tabular-nums"
						style={{ fontFamily: fonts.display, color: theme.text }}
					>
						{stats.skippedCount}
					</p>
					<p
						className="mt-1 text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						Skipped
					</p>
				</div>
			</div>

			<div className="mb-10">
				<p
					className="mb-4 text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Songs matched this session
				</p>
				<div className="flex gap-2">
					{songs.slice(0, 5).map((song) => (
						<div
							key={song.id}
							className="relative h-20 w-20 transition-transform hover:-translate-y-1"
						>
							<img
								src={song.albumArtUrl ?? undefined}
								alt={song.name}
								className="h-full w-full object-cover"
							/>
						</div>
					))}
				</div>
				<p
					className="mt-4 text-sm"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Your playlists have been updated
				</p>
			</div>

			<button
				onClick={onExit}
				className="group inline-flex items-center gap-3"
				style={{ fontFamily: fonts.body, color: theme.text }}
			>
				<span className="text-lg font-medium tracking-wide">Back to Home</span>
				<span
					className="inline-block transition-transform group-hover:translate-x-1"
					style={{ color: theme.textMuted }}
				>
					&rarr;
				</span>
			</button>
		</div>
	);
}
