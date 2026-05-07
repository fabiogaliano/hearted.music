import type { Playlist } from "@/lib/domains/library/playlists/queries";
import type { ListNavigationResult } from "@/lib/keyboard/types";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import { PlaylistCard } from "./PlaylistCard";

interface PlaylistLibraryProps {
	theme: ThemeConfig;
	playlists: Playlist[];
	onSelectPlaylist: (id: string, element: HTMLElement) => void;
	onAddPlaylist: (id: string) => void;
	closingToPlaylistId?: string | null;
	getItemProps: ListNavigationResult<Playlist>["getItemProps"];
	selectedPlaylistId?: string | null;
}

export function PlaylistLibrary({
	theme,
	playlists,
	onSelectPlaylist,
	onAddPlaylist,
	closingToPlaylistId,
	getItemProps,
	selectedPlaylistId,
}: PlaylistLibraryProps) {
	return (
		<div className="relative">
			<div className="sticky top-8">
				<div className="mb-6 flex items-center gap-3">
					<h3
						className="text-xs tracking-widest uppercase"
						style={{
							fontFamily: fonts.body,
							color: theme.textMuted,
						}}
					>
						Available
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

				<div className="space-y-0">
					{playlists.map((playlist, index) => {
						const itemProps = getItemProps(playlist, index);
						return (
							<PlaylistCard
								key={playlist.id}
								playlist={playlist}
								theme={theme}
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
						);
					})}
				</div>
			</div>
		</div>
	);
}
