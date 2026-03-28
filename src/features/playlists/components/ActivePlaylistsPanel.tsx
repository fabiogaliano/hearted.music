import type { Playlist } from "@/lib/domains/library/playlists/queries";
import type { ThemeConfig } from "@/lib/theme/types";
import { fonts } from "@/lib/theme/fonts";
import { PlaylistCard } from "./PlaylistCard";

interface ActivePlaylistsPanelProps {
	theme: ThemeConfig;
	playlists: Playlist[];
	onRemove: (id: string) => void;
	closingToPlaylistId?: string | null;
}

export function ActivePlaylistsPanel({
	theme,
	playlists,
	onRemove,
	closingToPlaylistId,
}: ActivePlaylistsPanelProps) {
	return (
		<div className="relative">
			<div className="sticky top-8">
				<div className="mb-6 flex items-center gap-3">
					<h3
						className="text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body, color: theme.text }}
					>
						Matching Playlists
					</h3>
					{playlists.length > 0 && (
						<span
							className="ml-auto text-xs tabular-nums"
							style={{
								fontFamily: fonts.body,
								color: theme.textMuted,
							}}
						>
							{playlists.length}
						</span>
					)}
				</div>

				{playlists.length === 0 ? (
					<div
						className="border-2 border-dashed p-6 text-center"
						style={{ borderColor: theme.border }}
					>
						<p
							className="text-sm"
							style={{
								fontFamily: fonts.body,
								color: theme.textMuted,
							}}
						>
							No active playlists yet.
						</p>
						<p
							className="mt-2 text-xs"
							style={{
								fontFamily: fonts.body,
								color: theme.textMuted,
							}}
						>
							Add playlists from the library to use for matching.
						</p>
					</div>
				) : (
					<div className="space-y-2">
						{playlists.map((playlist) => (
							<PlaylistCard
								key={playlist.id}
								playlist={playlist}
								theme={theme}
								status="active"
								onRemove={onRemove}
								isAnimatingTo={closingToPlaylistId === playlist.id}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
