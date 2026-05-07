import type { Playlist } from "@/lib/domains/library/playlists/queries";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import { PlaylistCard } from "./PlaylistCard";

interface ActivePlaylistsPanelProps {
	theme: ThemeConfig;
	playlists: Playlist[];
	onSelectPlaylist: (id: string, element: HTMLElement) => void;
	onRemove: (id: string) => void;
	columnRef: React.RefObject<HTMLDivElement | null>;
	isExpanded: boolean;
	closingToPlaylistId?: string | null;
	selectedPlaylistId?: string | null;
}

export function ActivePlaylistsPanel({
	theme,
	playlists,
	onSelectPlaylist,
	onRemove,
	columnRef,
	isExpanded,
	closingToPlaylistId,
	selectedPlaylistId,
}: ActivePlaylistsPanelProps) {
	return (
		<div ref={columnRef} className="relative">
			<div
				data-playlist-panel
				className={`sticky top-8 transition-opacity duration-200 ease-out ${isExpanded ? "pointer-events-none opacity-0" : "opacity-100"}`}
			>
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
						className="border border-dashed p-12 text-center"
						style={{ borderColor: theme.border }}
					>
						<p
							className="text-sm"
							style={{
								fontFamily: fonts.body,
								color: theme.textMuted,
							}}
						>
							No matching playlists yet.
						</p>
						<p
							className="mt-2 text-xs"
							style={{
								fontFamily: fonts.body,
								color: theme.textMuted,
							}}
						>
							Add playlists from the library to start matching.
						</p>
					</div>
				) : (
					<div className="space-y-0">
						{playlists.map((playlist) => (
							<PlaylistCard
								key={playlist.id}
								playlist={playlist}
								theme={theme}
								status="active"
								isSelected={selectedPlaylistId === playlist.id}
								onSelect={onSelectPlaylist}
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
