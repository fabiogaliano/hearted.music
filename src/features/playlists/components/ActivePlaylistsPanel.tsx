import type { Playlist } from "@/lib/domains/library/playlists/queries";
import { fonts } from "@/lib/theme/fonts";
import { PlaylistCard } from "./PlaylistCard";

interface ActivePlaylistsPanelProps {
	playlists: Playlist[];
	onSelectPlaylist: (id: string, element: HTMLElement) => void;
	onRemove: (id: string) => void;
	isExpanded: boolean;
	closingToPlaylistId?: string | null;
	selectedPlaylistId?: string | null;
	searchQuery: string | null;
	onClearSearch: () => void;
}

export function ActivePlaylistsPanel({
	playlists,
	onSelectPlaylist,
	onRemove,
	isExpanded,
	closingToPlaylistId,
	selectedPlaylistId,
	searchQuery,
	onClearSearch,
}: ActivePlaylistsPanelProps) {
	const isSearching = searchQuery !== null && searchQuery.length > 0;

	return (
		<div
			data-playlist-panel
			className={`sticky top-8 transition-opacity duration-200 ease-out ${isExpanded ? "pointer-events-none opacity-0" : "opacity-100"}`}
		>
			<div className="mb-5 flex items-baseline gap-3">
				<h3
					className="theme-text-muted text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
				>
					Matching Playlists
				</h3>
				{playlists.length > 0 && (
					<span
						className="theme-text-muted text-xs tabular-nums opacity-70"
						style={{ fontFamily: fonts.body }}
					>
						{playlists.length}
					</span>
				)}
			</div>

			{playlists.length === 0 ? (
				isSearching ? (
					<div className="pt-8 pb-4 max-w-md">
						<p
							className="theme-text text-xl leading-tight font-extralight italic text-balance"
							style={{ fontFamily: fonts.display }}
						>
							Nothing here for{" "}
							<span className="not-italic">“{searchQuery}”</span>.
						</p>
						<p
							className="theme-text-muted mt-3 text-sm leading-relaxed text-pretty"
							style={{ fontFamily: fonts.body }}
						>
							Try a different name, or clear the search.
						</p>
						<button
							type="button"
							onClick={onClearSearch}
							className="theme-text-muted mt-4 inline-flex h-10 cursor-pointer items-center text-xs tracking-widest uppercase transition-[color,opacity] duration-150 hover:text-(--t-text)"
							style={{ fontFamily: fonts.body }}
						>
							Clear search
						</button>
					</div>
				) : (
					<div className="pt-10 pb-12">
						<p
							className="theme-text text-2xl leading-tight font-extralight italic text-balance"
							style={{ fontFamily: fonts.display }}
						>
							No matching playlists yet.
						</p>
						<p
							className="theme-text-muted mt-3 max-w-md text-sm leading-relaxed text-pretty"
							style={{ fontFamily: fonts.body }}
						>
							Pick from the library on the right, your liked songs will find
							their way there.
						</p>
					</div>
				)
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
	);
}
