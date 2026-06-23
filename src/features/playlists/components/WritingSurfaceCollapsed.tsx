import { PlusIcon, WarningIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { fonts } from "@/lib/theme/fonts";
import { GenreChip } from "./GenreChip";
import { Label } from "./writingSurfaceShared";

// Caution accent for the "can't be matched" notice — amber, not red: an unfilled
// playlist is incomplete, not an error. A fixed status hue across all four themes,
// distinct from every theme accent so it reads as a warning rather than blending.
const CAUTION = "hsl(36, 72%, 44%)";
const EMPTY_DESCRIPTION =
	"Your liked songs find their way here by what you write. Describe what this playlist is for — a moment, a feeling, a sound.";

interface WritingSurfaceCollapsedProps {
	description: string | null;
	genres: string[];
	intentSerif: boolean;
	descriptionViewTransitionName?: string;
	hideUnmatchableWarning: boolean;
	collapsedFiltersSlot?: ReactNode;
	onEditDescription: () => void;
	onEditGenres: () => void;
}

/**
 * The writing surface collapsed (non-editing): the whole config (intent + genres
 * + filters) is one editable unit — each row opens the same editor — so it hovers
 * as one region rather than three.
 */
export function WritingSurfaceCollapsed({
	description,
	genres,
	intentSerif,
	descriptionViewTransitionName,
	hideUnmatchableWarning,
	collapsedFiltersSlot,
	onEditDescription,
	onEditGenres,
}: WritingSurfaceCollapsedProps) {
	// The intent leads the body: notably larger than the 11px eyebrow / 12px chips.
	const intentClass = intentSerif
		? "text-[22px] leading-snug"
		: "text-[17px] leading-relaxed";
	const intentFont = intentSerif ? fonts.display : fonts.body;

	return (
		// A background-only row hover (the house card/row idiom) lights the block;
		// the "Edit" eyebrow brightens with it via group-hover/edit, so the cue
		// fires no matter which row the cursor is over. The -mx-3/px-3 bleed gives
		// the hover fill some air past the text without shifting resting layout.
		<div className="group/edit relative -mx-3 flex flex-col gap-4 px-3 py-3 transition-colors duration-150 ease-[var(--ease-out-quart)] hover:bg-[color-mix(in_srgb,var(--t-surface)_55%,transparent)] motion-reduce:transition-none">
			{!hideUnmatchableWarning && !description && genres.length === 0 && (
				<div
					className="flex items-start gap-2.5 border-l-2 px-3 py-2.5"
					style={{
						borderColor: CAUTION,
						background: `color-mix(in srgb, ${CAUTION} 12%, transparent)`,
					}}
				>
					<WarningIcon
						size={15}
						weight="fill"
						aria-hidden
						className="mt-px flex-none"
						style={{ color: CAUTION }}
					/>
					<p
						className="theme-text m-0 text-xs leading-snug text-pretty"
						style={{ fontFamily: fonts.body }}
					>
						This playlist can’t be matched yet — give it a matching intent or
						some genres so songs can find their way here.
					</p>
				</div>
			)}

			<button
				type="button"
				onClick={onEditDescription}
				className="block w-full cursor-pointer text-left"
			>
				<div className="flex items-baseline justify-between gap-4">
					<Label>Matching intent</Label>
					<span
						className="flex-none text-[11px] tracking-[0.12em] text-(--t-text-muted) uppercase transition-colors duration-150 group-hover/edit:text-(--t-text)"
						style={{ fontFamily: fonts.body }}
					>
						Edit
					</span>
				</div>
				<p
					className={`mt-1.5 max-w-[56ch] text-pretty ${intentClass} ${description ? "theme-text" : "theme-text-muted"}`}
					style={{
						fontFamily: intentFont,
						viewTransitionName: descriptionViewTransitionName,
					}}
				>
					{description || EMPTY_DESCRIPTION}
				</p>
			</button>

			{genres.length > 0 ? (
				<button
					type="button"
					onClick={onEditGenres}
					aria-label="Edit genres"
					className="flex w-fit cursor-pointer flex-wrap items-center gap-1.5 text-left"
				>
					{genres.map((genre) => (
						<GenreChip key={genre}>{genre}</GenreChip>
					))}
				</button>
			) : (
				<button
					type="button"
					onClick={onEditGenres}
					className="theme-border-color inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-full border bg-(--t-surface) px-3 py-1 text-xs text-(--t-primary) transition-[color,border-color,background-color] duration-150 hover:border-(--t-primary) hover:bg-(--t-primary) hover:text-(--t-text-on-primary)"
					style={{ fontFamily: fonts.body }}
				>
					<PlusIcon size={12} weight="bold" aria-hidden />
					Add genres
				</button>
			)}

			{collapsedFiltersSlot}
		</div>
	);
}
