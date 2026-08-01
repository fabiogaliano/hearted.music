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
		// Evolved row: the divider goes and the hover carries the row instead. Its
		// old hover filled flat to --t-surface, which in the pastel themes is barely
		// off the page; the shared temperature step actually reads. The :has() arm
		// on .surface-raised-hover means focusing the overlay button — or Add/Remove
		// — lights the whole row, so keyboard and pointer see the same thing.
		// The -mx-3.5 bleed retires with the plane: the row fills the panel's padded
		// interior, so its hover no longer has to reach past a content column to
		// prove it's a target. px-3 + the panel's p-2 keeps the 20px content inset.
		// Geometry matched to SongCard so the two lists a user moves between read
		// as one component at two jobs: cover 54 -> 48, gap 18 -> 16, py 13 -> 12.
		<div className="group/row surface-raised-hover squircle relative grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-4 rounded-[10px] px-3 py-3 transition-[background-color] duration-150 ease-out">
			{/* Whole-row open affordance as a real <button>, overlaid rather than
			    wrapping the row so the inline Add/Remove buttons aren't nested inside
			    another button. z-[1] lifts it over the static cover/name/count;
			    the action column sits at z-[2] to stay clickable above it. */}
			<button
				type="button"
				aria-label={playlist.name}
				onClick={() => onOpen(playlist.id)}
				// Radius matches the row so the inset ring traces the row's real shape
				// rather than a square inside a rounded plane.
				className="squircle absolute inset-0 z-[1] cursor-pointer rounded-[10px] transition-colors duration-100 active:bg-(--t-text)/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--t-primary)/60 focus-visible:ring-inset"
			/>
			<Cover src={playlist.imageUrl} size={48} className="flex-none" />

			<div className="min-w-0">
				<div
					className="theme-text truncate text-[17px] leading-tight font-light"
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
							// The chip tier sits a step below the row's hover fill, so this
							// reads as a control resting ON the lit row rather than a second
							// patch of the same colour. Replaces a hand-rolled
							// transparent-border-that-appears-on-hover.
							className="theme-text-muted chip-raised chip-raised-hover squircle focus-edge inline-flex flex-none cursor-pointer items-center rounded-full px-2.5 py-1.5 text-[11px] tracking-[0.12em] uppercase opacity-0 transition-[color,background-color,opacity,transform] duration-150 group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:text-(--t-text) active:scale-[0.95]"
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
						// Keeps its own accent hover (ghost accent → solid accent): this is the
						// rail's affirmative action and that fill change is what carries it.
						// chip-raised only replaces the flat --t-surface + hairline it rested
						// on; the accent hover is a :hover rule so it still wins over it.
						className="chip-raised squircle focus-edge inline-flex flex-none cursor-pointer items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] tracking-[0.12em] text-(--t-primary) uppercase transition-[color,background-color,transform] duration-150 hover:bg-(--t-primary) hover:text-(--t-text-on-primary) active:scale-[0.95]"
						style={{ fontFamily: fonts.body }}
					>
						<span aria-hidden="true">＋</span> Add
					</button>
				)}
			</div>
		</div>
	);
}
