/**
 * PreviewRegionPlaceholder — seam for T6.
 *
 * T6 will replace this with animated, removable preview rows (enter/exit
 * animations, live count + duration, sonner undo toasts). The placeholder
 * renders a minimal list so the data flows through the hook and the screen
 * already feels functional.
 */

import type { SongVM } from "@/lib/domains/playlists/types";
import { fonts } from "@/lib/theme/fonts";

interface PreviewRegionPlaceholderProps {
	preview: SongVM[];
	isLoading: boolean;
	onRemoveSong: (id: string) => void;
}

export function PreviewRegionPlaceholder({
	preview,
	isLoading,
	onRemoveSong,
}: PreviewRegionPlaceholderProps) {
	if (isLoading && preview.length === 0) {
		return (
			<p
				className="theme-text-muted py-6 text-sm"
				style={{ fontFamily: fonts.body }}
			>
				One moment…
			</p>
		);
	}

	if (preview.length === 0) {
		return (
			<p
				className="theme-text-muted py-6 text-sm"
				style={{ fontFamily: fonts.body }}
			>
				No songs matched the current filters. Broaden your selection to see a
				preview.
			</p>
		);
	}

	return (
		<div>
			{/* T6 replaces this list with PreviewSongRow components with enter/exit
			    animations and sonner undo toasts on remove. */}
			<div
				className="theme-border-color mb-3 border border-dashed px-3 py-1.5"
				style={{ opacity: 0.4 }}
				aria-hidden="true"
			>
				<p
					className="theme-text-muted text-[11px] tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
				>
					T6 — animated PreviewSongRow components replace this list
				</p>
			</div>
			{preview.map((song) => (
				<div
					key={song.id}
					className="theme-border-color -mx-3 flex items-center gap-4 border-b px-3 py-3"
				>
					<div className="min-w-0 flex-1">
						<p
							className="theme-text truncate text-sm"
							style={{ fontFamily: fonts.body }}
						>
							{song.name}
						</p>
						<p
							className="theme-text-muted truncate text-xs"
							style={{ fontFamily: fonts.body }}
						>
							{song.artist}
						</p>
					</div>
					<button
						type="button"
						onClick={() => onRemoveSong(song.id)}
						className="theme-text-muted cursor-pointer text-[11px] tracking-widest uppercase transition-opacity duration-150 hover:opacity-70"
						style={{ fontFamily: fonts.body }}
					>
						Remove
					</button>
				</div>
			))}
		</div>
	);
}
