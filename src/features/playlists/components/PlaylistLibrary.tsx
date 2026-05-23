import type { Playlist } from "@/lib/domains/library/playlists/queries";
import type { ListNavigationResult } from "@/lib/keyboard/types";
import { fonts } from "@/lib/theme/fonts";
import { PlaylistCard } from "./PlaylistCard";

interface PlaylistLibraryProps {
	playlists: Playlist[];
	onSelectPlaylist: (id: string, element: HTMLElement) => void;
	onAddPlaylist: (id: string) => void;
	closingToPlaylistId?: string | null;
	getItemProps: ListNavigationResult<Playlist>["getItemProps"];
	selectedPlaylistId?: string | null;
	searchQuery: string | null;
	onClearSearch: () => void;
}

export function PlaylistLibrary({
	playlists,
	onSelectPlaylist,
	onAddPlaylist,
	closingToPlaylistId,
	getItemProps,
	selectedPlaylistId,
	searchQuery,
	onClearSearch,
}: PlaylistLibraryProps) {
	const isSearching = searchQuery !== null && searchQuery.length > 0;

	return (
		<div className="relative">
			<div className="sticky top-8">
				<div className="mb-5 flex items-baseline gap-3">
					<h3
						className="theme-text-muted text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Available
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
						<div className="mt-6 max-w-xs">
							<p
								className="theme-text-muted text-xs leading-relaxed text-pretty"
								style={{ fontFamily: fonts.body }}
							>
								Nothing in your library matches{" "}
								<span className="theme-text italic">“{searchQuery}”</span>.
							</p>
							<button
								type="button"
								onClick={onClearSearch}
								className="theme-text-muted mt-3 inline-flex h-9 cursor-pointer items-center text-[11px] tracking-widest uppercase transition-[color,opacity] duration-150 hover:text-(--t-text)"
								style={{ fontFamily: fonts.body }}
							>
								Clear search
							</button>
						</div>
					) : (
						<p
							className="theme-text-muted mt-6 max-w-xs text-sm leading-relaxed text-pretty"
							style={{ fontFamily: fonts.body }}
						>
							Every playlist's found a{" "}
							<em style={{ fontFamily: fonts.display, fontStyle: "italic" }}>
								home
							</em>
							. Free one up from the left to swap.
						</p>
					)
				) : (
					<ul className="space-y-0" aria-label="Available playlists">
						{playlists.map((playlist, index) => {
							const itemProps = getItemProps(playlist, index);
							return (
								<li key={playlist.id}>
									<PlaylistCard
										playlist={playlist}
										status="available"
										isSelected={selectedPlaylistId === playlist.id}
										onSelect={onSelectPlaylist}
										onAction={onAddPlaylist}
										isAnimatingTo={closingToPlaylistId === playlist.id}
										itemRef={itemProps.ref}
										tabIndex={itemProps.tabIndex}
										dataFocused={itemProps["data-focused"]}
										dataTabFocused={itemProps["data-tab-focused"]}
										navEngaged={itemProps["data-nav-engaged"]}
										onPointerDown={itemProps.onPointerDown}
										onFocus={itemProps.onFocus}
										onBlur={itemProps.onBlur}
									/>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</div>
	);
}
