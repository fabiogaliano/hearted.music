import type { Playlist } from "@/lib/domains/library/playlists/queries";
import { fonts } from "@/lib/theme/fonts";
import { PlaylistCard } from "./PlaylistCard";

interface ActivePlaylistsPanelProps {
	playlists: Playlist[];
	onSelectPlaylist: (id: string, element: HTMLElement) => void;
	onRemove: (id: string) => void;
	columnRef: React.RefObject<HTMLDivElement | null>;
	isExpanded: boolean;
	closingToPlaylistId?: string | null;
	selectedPlaylistId?: string | null;
}

export function ActivePlaylistsPanel({
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
						className="theme-text text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Matching Playlists
					</h3>
					{playlists.length > 0 && (
						<span
							className="theme-text-muted ml-auto text-xs tabular-nums"
							style={{ fontFamily: fonts.body }}
						>
							{playlists.length}
						</span>
					)}
				</div>

				{playlists.length === 0 ? (
					<div className="theme-border-color border border-dashed p-12 text-center">
						<p
							className="theme-text-muted text-sm"
							style={{ fontFamily: fonts.body }}
						>
							No matching playlists yet.
						</p>
						<p
							className="theme-text-muted mt-2 text-xs"
							style={{ fontFamily: fonts.body }}
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
