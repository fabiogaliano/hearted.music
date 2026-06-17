import { fonts } from "@/lib/theme/fonts";
import { Cover } from "./Cover";
import type { PlaylistSummary } from "./types";

interface RailRowProps {
	playlist: PlaylistSummary;
	onOpen: (id: string) => void;
	onAdd: (id: string) => void;
	onRemove: (id: string) => void;
	/** Suppress the inline "＋ Add" — the onboarding preview adds via the panel. */
	hideAdd?: boolean;
}

/**
 * One rail row: cover, serif name, and song count as the subtitle. Matching
 * intent is deliberately absent here — it's a property of being *in* matching,
 * so the library stays a calm staging shelf. Inline add, hover-revealed remove.
 */
export function RailRow({
	playlist,
	onOpen,
	onAdd,
	onRemove,
	hideAdd = false,
}: RailRowProps) {
	return (
		<div className="group/row theme-border-color theme-hover-surface relative -mx-3.5 grid grid-cols-[54px_minmax(0,1fr)_auto] items-center gap-3 border-b px-3.5 py-[13px] last:border-b-0 md:gap-[18px]">
			{/* Whole-row open affordance as a real <button>, overlaid rather than
			    wrapping the row so the inline Add/Remove buttons aren't nested inside
			    another button. z-[1] lifts it over the static cover/name/count;
			    the action column sits at z-[2] to stay clickable above it. */}
			<button
				type="button"
				aria-label={playlist.name}
				onClick={() => onOpen(playlist.id)}
				className="absolute inset-0 z-[1] cursor-pointer transition-colors duration-100 active:bg-(--t-text)/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--t-primary)/60 focus-visible:ring-inset"
			/>
			<Cover src={playlist.imageUrl} size={54} className="flex-none" />

			<div className="min-w-0">
				<div
					className="theme-text truncate text-xl leading-tight font-light"
					style={{ fontFamily: fonts.display }}
				>
					{playlist.name}
				</div>
				<div
					className="theme-text-muted mt-0.5 truncate text-[13px] leading-tight tabular-nums"
					style={{ fontFamily: fonts.body }}
				>
					{playlist.songCount} {playlist.songCount === 1 ? "song" : "songs"}
				</div>
			</div>

			<div className="relative z-[2] flex items-center justify-end gap-3 md:min-w-[132px]">
				{playlist.isTarget ? (
					<>
						<span
							className="theme-primary hidden text-[10px] tracking-[0.14em] uppercase whitespace-nowrap md:inline"
							style={{ fontFamily: fonts.body }}
						>
							In matching
						</span>
						<button
							type="button"
							onClick={(event) => {
								event.stopPropagation();
								onRemove(playlist.id);
							}}
							className="theme-text-muted theme-hover-surface inline-flex flex-none cursor-pointer items-center rounded-full border border-transparent px-2.5 py-1.5 text-[11px] tracking-[0.12em] uppercase opacity-0 transition-[color,border-color,background-color,opacity,transform] duration-150 group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:border-(--t-border) hover:text-(--t-text) active:scale-[0.95]"
							style={{ fontFamily: fonts.body }}
						>
							Remove
						</button>
					</>
				) : hideAdd ? null : (
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							onAdd(playlist.id);
						}}
						className="theme-border-color inline-flex flex-none cursor-pointer items-center gap-1 rounded-full border bg-(--t-surface) px-2.5 py-1.5 text-[11px] tracking-[0.12em] text-(--t-primary) uppercase transition-[color,border-color,background-color,transform] duration-150 hover:border-(--t-primary) hover:bg-(--t-primary) hover:text-(--t-text-on-primary) active:scale-[0.95]"
						style={{ fontFamily: fonts.body }}
					>
						<span aria-hidden="true">＋</span> Add
					</button>
				)}
			</div>
		</div>
	);
}
