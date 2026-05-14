import { memo } from "react";
import { Button } from "@/components/ui/Button";
import { fonts } from "@/lib/theme/fonts";
import type { CompletionScreenProps } from "../types";

export const CompletionScreen = memo(function CompletionScreen({
	stats,
	songs,
	onExit,
}: CompletionScreenProps) {
	return (
		<div className="max-w-4xl">
			<div className="mb-8 flex items-start justify-between">
				<div>
					<p
						className="theme-text-muted text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Session Complete
					</p>
					<h2
						className="theme-text mt-3 text-page-title font-extralight tracking-tight"
						style={{ fontFamily: fonts.display }}
					>
						All matched
					</h2>
				</div>
				<div
					className="theme-text-muted flex items-center gap-2 text-xs"
					style={{ fontFamily: fonts.body }}
				>
					<span className="flex items-center gap-2">
						<span className="theme-text-muted-bg h-1.5 w-1.5 rounded-full" />
						Just now
					</span>
				</div>
			</div>

			<div className="theme-border-bg mb-10 h-px" />

			<div className="mb-10 grid grid-cols-3 gap-8">
				<div>
					<p
						className="theme-text text-4xl font-extralight tabular-nums"
						style={{ fontFamily: fonts.display }}
					>
						{stats.totalSongs}
					</p>
					<p
						className="theme-text-muted mt-1 text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Songs reviewed
					</p>
				</div>
				<div>
					<p
						className="theme-text text-4xl font-extralight tabular-nums"
						style={{ fontFamily: fonts.display }}
					>
						{stats.totalAdditions}
					</p>
					<p
						className="theme-text-muted mt-1 text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Playlist additions
					</p>
				</div>
				<div>
					<p
						className="theme-text text-4xl font-extralight tabular-nums"
						style={{ fontFamily: fonts.display }}
					>
						{stats.skippedCount}
					</p>
					<p
						className="theme-text-muted mt-1 text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Skipped
					</p>
				</div>
			</div>

			<div className="mb-10">
				<p
					className="theme-text-muted mb-4 text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
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
					className="theme-text-muted mt-4 text-sm"
					style={{ fontFamily: fonts.body }}
				>
					Your playlists have been updated
				</p>
			</div>

			<Button
				variant="link"
				onClick={onExit}
				style={{ fontFamily: fonts.body }}
			>
				<span className="text-base font-medium tracking-wide">
					Back to Home
				</span>
				<span className="theme-text-muted inline-block transition-transform group-hover:translate-x-1">
					&rarr;
				</span>
			</Button>
		</div>
	);
});
