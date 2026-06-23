/**
 * SuggestionsRegionPlaceholder — seam for T6.
 *
 * T6 will replace this with the SuggestionsTray: animated rows with optimistic
 * add, soft-refresh on config change, and distinct visual treatment vs. picks.
 */

import type { SongVM } from "@/lib/domains/playlists/types";
import { fonts } from "@/lib/theme/fonts";

interface SuggestionsRegionPlaceholderProps {
	suggestions: SongVM[];
	onAddSong: (id: string) => void;
}

export function SuggestionsRegionPlaceholder({
	suggestions,
	onAddSong,
}: SuggestionsRegionPlaceholderProps) {
	if (suggestions.length === 0) {
		return (
			<p
				className="theme-text-muted py-6 text-sm"
				style={{ fontFamily: fonts.body }}
			>
				No suggestions yet. Try adjusting your filters.
			</p>
		);
	}

	return (
		<div>
			{/* T6 replaces this with SuggestionRow components with optimistic add
			    and a soft-refresh feed. */}
			<div
				className="theme-border-color mb-3 border border-dashed px-3 py-1.5"
				style={{ opacity: 0.4 }}
				aria-hidden="true"
			>
				<p
					className="theme-text-muted text-[11px] tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
				>
					T6 — SuggestionsTray with optimistic add replaces this list
				</p>
			</div>
			{suggestions.map((song) => (
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
						onClick={() => onAddSong(song.id)}
						className="theme-text-muted cursor-pointer text-[11px] tracking-widest uppercase transition-opacity duration-150 hover:opacity-70"
						style={{ fontFamily: fonts.body }}
					>
						Add
					</button>
				</div>
			))}
		</div>
	);
}
