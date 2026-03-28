import type { Playlist } from "@/lib/domains/library/playlists/queries";
import type { ListNavigationResult } from "@/lib/keyboard/types";
import type { ThemeConfig } from "@/lib/theme/types";
import { fonts } from "@/lib/theme/fonts";
import { PlaylistCard } from "./PlaylistCard";

interface PlaylistLibraryProps {
	theme: ThemeConfig;
	playlists: Playlist[];
	onSelectPlaylist: (id: string, e: React.MouseEvent<HTMLDivElement>) => void;
	onAddPlaylist: (id: string) => void;
	columnRef: React.RefObject<HTMLDivElement | null>;
	isExpanded: boolean;
	closingToPlaylistId?: string | null;
	getItemProps: ListNavigationResult<Playlist>["getItemProps"];
}

export function PlaylistLibrary({
	theme,
	playlists,
	onSelectPlaylist,
	onAddPlaylist,
	columnRef,
	isExpanded,
	closingToPlaylistId,
	getItemProps,
}: PlaylistLibraryProps) {
	return (
		<div
			ref={columnRef}
			className="relative grid grid-cols-1 grid-rows-1 overflow-hidden"
		>
			<div
				data-playlist-panel
				className={`col-start-1 row-start-1 transition-opacity duration-200 ease-out ${isExpanded ? "pointer-events-none opacity-0" : "opacity-100"}`}
			>
				<h3
					className="mb-6 text-xs tracking-widest uppercase"
					style={{
						fontFamily: fonts.body,
						color: theme.textMuted,
					}}
				>
					Available Library · {playlists.length}
				</h3>

				<div className="space-y-0">
					{playlists.map((playlist, index) => {
						const itemProps = getItemProps(playlist, index);
						return (
							<PlaylistCard
								key={playlist.id}
								playlist={playlist}
								theme={theme}
								status="available"
								onSelect={onSelectPlaylist}
								onAction={onAddPlaylist}
								isAnimatingTo={closingToPlaylistId === playlist.id}
								itemRef={itemProps.ref}
								tabIndex={itemProps.tabIndex}
								dataFocused={itemProps["data-focused"]}
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
