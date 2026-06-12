import {
	type CSSProperties,
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
} from "react";
import { Button } from "@/components/ui/Button";
import { fonts } from "@/lib/theme/fonts";
import { GenrePillsPicker } from "./GenrePillsPicker";

const GENRE_HINT = "A little pull, so the right songs know where home is.";
const EMPTY_DESCRIPTION =
	"Describe what this playlist is for — a moment, a feeling, a sound, a genre. Your liked songs find their way here by what you write.";

// Read-only chip accent mirrors the picker's selected-chip treatment so the
// collapsed declaration matches what the editor shows. color-mix needs the
// literal var, hence inline rather than Tailwind opacity modifiers.
const readonlyChipStyle: CSSProperties = {
	color: "var(--t-primary)",
	borderColor: "color-mix(in srgb, var(--t-primary) 32%, transparent)",
	backgroundColor: "color-mix(in srgb, var(--t-primary) 9%, transparent)",
	fontFamily: fonts.body,
};

interface PlaylistWritingSurfaceProps {
	/** Saved description (shown collapsed). */
	description: string | null;
	/** Saved genre pills (shown collapsed). */
	genres: string[];
	isEditing: boolean;
	draftDescription: string;
	draftGenres: string[];
	topGenres?: readonly string[];
	isSaving?: boolean;
	/** Render without the standalone card chrome (border/fill/radius/shadow/focus
	 *  ring) so the surface can sit as the body of an outer container — the
	 *  onboarding combined card. The detail view leaves this off (default). */
	embedded?: boolean;
	/** Label for the edit-mode dismiss button. Defaults to "Cancel". Both the
	 *  detail view and the onboarding dialog revert to the collapsed display on
	 *  cancel, so neither overrides it today; the prop stays for callers that want
	 *  a different verb. */
	cancelLabel?: string;
	/** Label for the edit-mode primary (save) button. Defaults to "Save" (detail
	 *  view). The onboarding dialog passes "Continue and save", where saving also
	 *  advances the step. The in-flight "Saving…" label is unaffected. */
	saveLabel?: string;
	/** Names the collapsed description <p> for the card→panel shared-element
	 *  morph. Only the detail view sets it; the onboarding dialog omits it. */
	descriptionViewTransitionName?: string;
	/**
	 * Caller-owned UI rendered just under the Save/Cancel row in edit mode:
	 * extension/reconnect prompts, save errors, the conflict dialog. The surface
	 * stays presentational; the description-save state machine lives in the
	 * caller, so its feedback lands here without this component knowing about it.
	 */
	editFooter?: ReactNode;
	/** Enter edit with the description textarea focused. */
	onEditDescription: () => void;
	/** Enter edit with the genre picker focused. */
	onEditGenres: () => void;
	onDraftDescriptionChange: (value: string) => void;
	onDraftGenresChange: (next: string[]) => void;
	onSave: () => void;
	onCancel: () => void;
}

/**
 * One writing surface for a playlist's description and genres, sharing a single
 * Edit → Save/Cancel. Display shows the description plus the chosen genre chips
 * (or a "+ Add genres" affordance); clicking either opens the full editor —
 * description textarea above a divider, the genre picker below. Save commits
 * both; the genres and the description persist through different paths, so the
 * caller owns the save flow and feeds any failure UI back via `editFooter`.
 *
 * Presentational: the caller owns draft state, persistence, and edit toggling.
 */
export function PlaylistWritingSurface({
	description,
	genres,
	isEditing,
	draftDescription,
	draftGenres,
	topGenres,
	isSaving = false,
	embedded = false,
	cancelLabel = "Cancel",
	saveLabel = "Save",
	descriptionViewTransitionName,
	editFooter,
	onEditDescription,
	onEditGenres,
	onDraftDescriptionChange,
	onDraftGenresChange,
	onSave,
	onCancel,
}: PlaylistWritingSurfaceProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	// Which control to focus once edit mode mounts — set by whichever display
	// affordance was clicked, consumed by the focus effect below.
	const focusTargetRef = useRef<"description" | "genres">("description");

	const enterDescription = () => {
		focusTargetRef.current = "description";
		onEditDescription();
	};
	const enterGenres = () => {
		focusTargetRef.current = "genres";
		onEditGenres();
	};

	// Grow the textarea to its content so the divider sits right under the last
	// line instead of below a fixed-height box.
	const autosize = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = "auto";
		textarea.style.height = `${textarea.scrollHeight}px`;
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: draftDescription drives the resize timing — autosize reads the textarea via ref, so the dep isn't statically visible
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

	return (
		<div
			className={
				embedded
					? "playlist-writing-surface-embedded"
					: "playlist-writing-surface"
			}
		>
			{isEditing ? (
				<>
					<textarea
						ref={textareaRef}
						value={draftDescription}
						onChange={(event) => onDraftDescriptionChange(event.target.value)}
						onInput={autosize}
						placeholder="What's this playlist about?"
						rows={1}
						disabled={isSaving}
						className="theme-text w-full resize-none overflow-hidden bg-transparent p-0 text-base leading-relaxed outline-none disabled:opacity-60"
						style={{ fontFamily: fonts.body }}
					/>

					<div className="pws-divider" />

					{/* Only this region is new when opening the editor — the description
					   and divider carry over from display — so the entrance animation is
					   scoped here, not the whole card. */}
					<div className="playlist-surface-reveal flex flex-col gap-3">
						<GenrePillsPicker
							value={draftGenres}
							onChange={onDraftGenresChange}
							topGenres={topGenres}
							disabled={isSaving}
							autoFocus={focusTargetRef.current === "genres"}
						/>
						<p
							className="theme-text-muted text-xs leading-relaxed text-pretty"
							style={{ fontFamily: fonts.body }}
						>
							{GENRE_HINT}
						</p>
					</div>

					<div className="flex items-center justify-end gap-3">
						<Button
							variant="ghost"
							size="sm"
							onClick={onCancel}
							disabled={isSaving}
							style={{ fontFamily: fonts.body }}
						>
							{cancelLabel}
						</Button>
						<Button
							size="sm"
							onClick={onSave}
							disabled={isSaving}
							style={{ fontFamily: fonts.body }}
						>
							{isSaving ? "Saving…" : saveLabel}
						</Button>
					</div>

					{editFooter}
				</>
			) : (
				<>
					<button
						type="button"
						onClick={enterDescription}
						className="group/desc flex w-full cursor-pointer items-start gap-4 text-left"
					>
						<p
							className={`flex-1 text-base leading-relaxed text-pretty ${description ? "theme-text" : "theme-text-muted"}`}
							style={{
								fontFamily: fonts.body,
								viewTransitionName: descriptionViewTransitionName,
							}}
						>
							{description || EMPTY_DESCRIPTION}
						</p>
						<span
							className="theme-text-muted mt-[3px] flex-shrink-0 text-[11px] tracking-[0.12em] uppercase transition-colors duration-150 group-hover/desc:text-(--t-text)"
							style={{ fontFamily: fonts.body }}
						>
							Edit
						</span>
					</button>

					<div className="pws-divider" />

					{genres.length > 0 ? (
						<button
							type="button"
							onClick={enterGenres}
							aria-label="Edit genres"
							className="flex w-fit cursor-pointer flex-wrap items-center gap-1.5 text-left"
						>
							{genres.map((genre) => (
								<span
									key={genre}
									className="rounded-full border px-3 py-1 text-xs"
									style={readonlyChipStyle}
								>
									{genre}
								</span>
							))}
						</button>
					) : (
						<button
							type="button"
							onClick={enterGenres}
							className="theme-border-color theme-text-muted inline-flex w-fit cursor-pointer items-center gap-1 rounded-full border border-dashed px-3 py-1 text-xs transition-[color,border-color,background-color] duration-150 hover:border-(--t-primary)/45 hover:text-(--t-primary)"
							style={{ fontFamily: fonts.body }}
						>
							<span aria-hidden="true" className="opacity-70">
								+
							</span>
							Add genres
						</button>
					)}
				</>
			)}
		</div>
	);
}
