import { PlusIcon, WarningIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { fonts } from "@/lib/theme/fonts";
import { GenrePillsPicker } from "../GenrePillsPicker";
import { GenreChip } from "./GenreChip";
import { InfoTip } from "./InfoTip";
import "./playlist-explorations.css";

const GENRE_MAX = 5;
// Caution accent for the "can't be matched" notice — amber, not red: an unfilled
// playlist is incomplete, not an error. A fixed status hue across all four themes,
// distinct from every theme accent so it reads as a warning rather than blending.
const CAUTION = "hsl(36, 72%, 44%)";
const EMPTY_DESCRIPTION =
	"Your liked songs find their way here by what you write. Describe what this playlist is for — a moment, a feeling, a sound.";

// Eyebrows + the Edit affordance: weighted 70% toward full ink so they clear
// 4.5:1 on the darker masthead band (measured — 55% landed at ~4.0, just under).
const EYEBROW_COLOR =
	"color-mix(in srgb, var(--t-text) 70%, var(--t-text-muted))";

interface WritingSurfaceProps {
	description: string | null;
	genres: string[];
	isEditing: boolean;
	draftDescription: string;
	draftGenres: string[];
	topGenres?: readonly string[];
	isSaving?: boolean;
	/** Render the intent in the display serif — the brand's editorial voice. */
	intentSerif?: boolean;
	/** Names the collapsed description for a card→panel shared-element morph. */
	descriptionViewTransitionName?: string;
	/** Hide the "can't be matched yet" caution — used in the onboarding rehearsal
	 *  where canned playlists start empty and the nudge would be noise. */
	hideUnmatchableWarning?: boolean;
	onEditDescription: () => void;
	onEditGenres: () => void;
	onDraftDescriptionChange: (value: string) => void;
	onDraftGenresChange: (next: string[]) => void;
	onSave: () => void;
	onCancel: () => void;
}

/**
 * The writing surface, presentational and frame-agnostic. Hierarchy comes from
 * type + space, not chrome (no card, no border): the intent is the primary body
 * element — larger, full ink — under a single Intent eyebrow; the genres sit just
 * below it without their own label, since chosen genres read as part of the intent.
 * Surrounding zone chrome is owned by the composing panel/hero so this stays
 * reusable across variants.
 */
export function WritingSurface({
	description,
	genres,
	isEditing,
	draftDescription,
	draftGenres,
	topGenres,
	isSaving = false,
	intentSerif = false,
	descriptionViewTransitionName,
	hideUnmatchableWarning = false,
	onEditDescription,
	onEditGenres,
	onDraftDescriptionChange,
	onDraftGenresChange,
	onSave,
	onCancel,
}: WritingSurfaceProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const focusTargetRef = useRef<"description" | "genres">("description");

	const enterDescription = () => {
		focusTargetRef.current = "description";
		onEditDescription();
	};
	const enterGenres = () => {
		focusTargetRef.current = "genres";
		onEditGenres();
	};

	const autosize = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = "auto";
		textarea.style.height = `${textarea.scrollHeight}px`;
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: draftDescription drives the resize; autosize reads the textarea via ref
	useLayoutEffect(() => {
		if (isEditing) autosize();
	}, [isEditing, draftDescription, autosize]);

	useEffect(() => {
		if (!isEditing || focusTargetRef.current !== "description") return;
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.focus();
		const end = textarea.value.length;
		textarea.setSelectionRange(end, end);
	}, [isEditing]);

	// The intent leads the body: notably larger than the 11px eyebrow / 12px chips.
	const intentClass = intentSerif
		? "text-[22px] leading-snug"
		: "text-[17px] leading-relaxed";
	const intentFont = intentSerif ? fonts.display : fonts.body;
	const genresAtCap = draftGenres.length >= GENRE_MAX;

	if (isEditing) {
		return (
			<div className="relative flex flex-col gap-7">
				<div className="flex flex-col gap-1.5">
					<Label>Matching intent</Label>
					<textarea
						ref={textareaRef}
						value={draftDescription}
						onChange={(event) => onDraftDescriptionChange(event.target.value)}
						onInput={autosize}
						placeholder="What is this playlist for?"
						rows={1}
						disabled={isSaving}
						className={`theme-text w-full resize-none overflow-hidden bg-transparent p-0 outline-none placeholder:text-(--t-text-muted) disabled:opacity-60 ${intentClass}`}
						style={{ fontFamily: intentFont }}
					/>
				</div>

				<div className="xpl-genres xpl-reveal flex flex-col gap-2">
					<div className="flex items-center justify-between gap-2">
						<div className="flex items-center gap-1.5">
							<Label>Genres</Label>
							<InfoTip label="About genres">
								Optional, but they help — a gentle pull so the right songs know
								where home is.
							</InfoTip>
						</div>
						<span
							className="text-xs tabular-nums"
							style={{
								fontFamily: fonts.body,
								color: genresAtCap ? "var(--t-primary)" : EYEBROW_COLOR,
							}}
						>
							{draftGenres.length}
							<span className="opacity-60">/{GENRE_MAX}</span>
						</span>
					</div>
					<GenrePillsPicker
						value={draftGenres}
						onChange={onDraftGenresChange}
						topGenres={topGenres}
						maxPills={GENRE_MAX}
						disabled={isSaving}
						autoFocus={focusTargetRef.current === "genres"}
					/>
				</div>

				<div className="flex items-center justify-end gap-2">
					<Button
						variant="ghost"
						size="sm"
						onClick={onCancel}
						disabled={isSaving}
						style={{ fontFamily: fonts.body }}
					>
						Cancel
					</Button>
					<Button
						size="sm"
						onClick={onSave}
						disabled={isSaving}
						style={{ fontFamily: fonts.body }}
					>
						{isSaving ? "Saving…" : "Save"}
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="relative flex flex-col gap-4">
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
				onClick={enterDescription}
				className="group/desc block w-full cursor-pointer text-left"
			>
				<div className="flex items-baseline justify-between gap-4">
					<Label>Matching intent</Label>
					<span
						className="flex-none text-[11px] tracking-[0.12em] text-[color-mix(in_srgb,var(--t-text)_70%,var(--t-text-muted))] uppercase transition-colors duration-150 group-hover/desc:text-(--t-text)"
						style={{ fontFamily: fonts.body }}
					>
						Edit
					</span>
				</div>
				<p
					className={`mt-1.5 text-pretty ${intentClass} ${description ? "theme-text" : "theme-text-muted"}`}
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
					onClick={enterGenres}
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
					onClick={enterGenres}
					className="theme-border-color inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-full border bg-(--t-surface) px-3 py-1 text-xs text-(--t-primary) transition-[color,border-color,background-color] duration-150 hover:border-(--t-primary) hover:bg-(--t-primary) hover:text-(--t-text-on-primary)"
					style={{ fontFamily: fonts.body }}
				>
					<PlusIcon size={12} weight="bold" aria-hidden />
					Add genres
				</button>
			)}
		</div>
	);
}

/** The small uppercase section eyebrow, strong enough to read on the dark band. */
function Label({ children }: { children: string }) {
	return (
		<span
			className="text-[11px] font-medium tracking-[0.18em] uppercase"
			style={{ fontFamily: fonts.body, color: EYEBROW_COLOR }}
		>
			{children}
		</span>
	);
}
