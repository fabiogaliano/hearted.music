import {
	type CSSProperties,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
} from "react";
import { Button } from "@/components/ui/Button";
import { fonts } from "@/lib/theme/fonts";
import { GenrePicker } from "./GenrePicker";
import "./playlist-explorations.css";

const GENRE_HINT = "A little pull, so the right songs know where home is.";
const EMPTY_DESCRIPTION =
	"Describe what this playlist is for — a moment, a feeling, a sound. Your liked songs find their way here by what you write.";

const selectedChipStyle: CSSProperties = {
	color: "var(--t-primary)",
	borderColor: "color-mix(in srgb, var(--t-primary) 32%, transparent)",
	backgroundColor: "color-mix(in srgb, var(--t-primary) 9%, transparent)",
	fontFamily: fonts.body,
};

interface WritingSurfaceProps {
	description: string | null;
	genres: string[];
	isEditing: boolean;
	draftDescription: string;
	draftGenres: string[];
	topGenres?: readonly string[];
	isSaving?: boolean;
	/** Names the collapsed description for a card→panel shared-element morph. */
	descriptionViewTransitionName?: string;
	onEditDescription: () => void;
	onEditGenres: () => void;
	onDraftDescriptionChange: (value: string) => void;
	onDraftGenresChange: (next: string[]) => void;
	onSave: () => void;
	onCancel: () => void;
}

/**
 * Lab-faithful writing surface: collapsed it shows the intent + genre chips
 * (or a "+ Add genres" affordance); one Edit opens the textarea above the genre
 * picker, with one Save/Cancel for both. The round-2 nits are baked in — square
 * corners (no card chrome), the labelled genres/suggestions split lives in
 * GenrePicker, and the hint anchors the action row's left so nothing floats.
 * Presentational: the caller owns draft state, persistence, and edit toggling.
 */
export function WritingSurface({
	description,
	genres,
	isEditing,
	draftDescription,
	draftGenres,
	topGenres,
	isSaving = false,
	descriptionViewTransitionName,
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

	if (isEditing) {
		return (
			<div className="relative flex flex-col gap-3.5">
				<textarea
					ref={textareaRef}
					value={draftDescription}
					onChange={(event) => onDraftDescriptionChange(event.target.value)}
					onInput={autosize}
					placeholder="What's this playlist about?"
					rows={1}
					disabled={isSaving}
					className="theme-text w-full resize-none overflow-hidden bg-transparent p-0 text-[15px] leading-relaxed outline-none placeholder:text-(--t-text-muted) disabled:opacity-60"
					style={{ fontFamily: fonts.body }}
				/>

				<Divider />

				<div className="xpl-reveal flex flex-col gap-3.5">
					<GenrePicker
						value={draftGenres}
						onChange={onDraftGenresChange}
						topGenres={topGenres}
						disabled={isSaving}
						autoFocus={focusTargetRef.current === "genres"}
					/>
				</div>

				<div className="flex items-center justify-between gap-4">
					<p
						className="theme-text-muted m-0 min-w-0 flex-1 text-xs leading-snug text-pretty"
						style={{ fontFamily: fonts.body }}
					>
						{GENRE_HINT}
					</p>
					<div className="flex flex-none items-center gap-2">
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
			</div>
		);
	}

	return (
		<div className="relative flex flex-col gap-3.5">
			<button
				type="button"
				onClick={enterDescription}
				className="group/desc flex w-full cursor-pointer items-start gap-4 text-left"
			>
				<span
					className={`flex-1 text-[15px] leading-relaxed text-pretty ${description ? "theme-text" : "theme-text-muted"}`}
					style={{
						fontFamily: fonts.body,
						viewTransitionName: descriptionViewTransitionName,
					}}
				>
					{description || EMPTY_DESCRIPTION}
				</span>
				<span
					className="theme-text-muted mt-[3px] flex-none text-[11px] tracking-[0.12em] uppercase transition-colors duration-150 group-hover/desc:text-(--t-text)"
					style={{ fontFamily: fonts.body }}
				>
					Edit
				</span>
			</button>

			<Divider />

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
							style={selectedChipStyle}
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
		</div>
	);
}

/** Hairline rule that fades at both ends — the writing surface's section break. */
function Divider() {
	return (
		<div
			className="h-px"
			style={{
				background:
					"linear-gradient(90deg, transparent, color-mix(in srgb, var(--t-border) 95%, transparent) 8%, color-mix(in srgb, var(--t-border) 95%, transparent) 92%, transparent)",
			}}
		/>
	);
}
