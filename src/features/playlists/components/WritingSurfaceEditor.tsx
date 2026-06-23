import {
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
} from "react";
import { Button } from "@/components/ui/Button";
import { fonts } from "@/lib/theme/fonts";
import type { DescriptionExample } from "./DescriptionExamplesShuffle";
import { GenrePillsPicker } from "./GenrePillsPicker";
import { InfoTip } from "./InfoTip";
import { IntentExamplesPopover } from "./IntentExamplesPopover";
import { EYEBROW_COLOR, Label } from "./writingSurfaceShared";

const GENRE_MAX = 5;

interface WritingSurfaceEditorProps {
	draftDescription: string;
	draftGenres: string[];
	topGenres?: readonly string[];
	isSaving: boolean;
	saveError?: string | null;
	intentSerif: boolean;
	intentPlaceholder: string;
	lockManualEntry: boolean;
	examplesSlot?: ReactNode;
	intentExamples?: readonly DescriptionExample[];
	advancedFilters?: ReactNode;
	/** Which control to focus when the editor mounts — set by the collapsed row the
	 *  user clicked, read here so "Edit genres" lands in the genre picker. */
	focusTargetRef: RefObject<"description" | "genres">;
	onDraftDescriptionChange: (value: string) => void;
	onDraftGenresChange: (next: string[]) => void;
	onSave: () => void;
	onCancel: () => void;
}

/**
 * The writing surface in edit mode: the intent textarea (with its autosize and
 * autofocus), the genre picker, the optional advanced-filters slot, and the
 * Save/Cancel row. Mounted only while editing, so its focus effects run on mount.
 */
export function WritingSurfaceEditor({
	draftDescription,
	draftGenres,
	topGenres,
	isSaving,
	saveError = null,
	intentSerif,
	intentPlaceholder,
	lockManualEntry,
	examplesSlot,
	intentExamples,
	advancedFilters,
	focusTargetRef,
	onDraftDescriptionChange,
	onDraftGenresChange,
	onSave,
	onCancel,
}: WritingSurfaceEditorProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const autosize = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = "auto";
		textarea.style.height = `${textarea.scrollHeight}px`;
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: draftDescription drives the resize; autosize reads the textarea via ref
	useLayoutEffect(() => {
		autosize();
	}, [draftDescription, autosize]);

	// Skip autofocus in lock mode — the field is read-only (pick-to-fill), so a
	// blinking caret in a textarea you can't type into would only mislead.
	useEffect(() => {
		if (lockManualEntry || focusTargetRef.current !== "description") return;
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.focus();
		const end = textarea.value.length;
		textarea.setSelectionRange(end, end);
	}, [lockManualEntry, focusTargetRef]);

	// The intent leads the body: notably larger than the 11px eyebrow / 12px chips.
	const intentClass = intentSerif
		? "text-[22px] leading-snug"
		: "text-[17px] leading-relaxed";
	const intentFont = intentSerif ? fonts.display : fonts.body;
	const genresAtCap = draftGenres.length >= GENRE_MAX;
	// In guided mode the field opens on the example picker and only flips to the
	// (read-only) text once a draft exists — i.e. once an example's been picked.
	const picked = draftDescription.trim() !== "";

	const intentField = (
		<textarea
			ref={textareaRef}
			value={draftDescription}
			onChange={(event) => onDraftDescriptionChange(event.target.value)}
			onInput={autosize}
			placeholder={intentPlaceholder}
			rows={1}
			disabled={isSaving}
			readOnly={lockManualEntry}
			className={`theme-text w-full max-w-[56ch] resize-none overflow-hidden bg-transparent p-0 outline-none placeholder:text-(--t-text-muted) disabled:opacity-60 ${lockManualEntry ? "cursor-default" : ""} ${intentClass}`}
			style={{ fontFamily: intentFont }}
		/>
	);

	return (
		// gap-0: the flat .match-zone sections own their own vertical rhythm
		// (padding + a hairline rule between them) on the lifted surface plane.
		// Same lit tint + -mx-3 bleed as the collapsed region so entering edit
		// keeps the block lit with no colour jump — the hover settles into a
		// persistent state rather than swapping to a bare surface.
		<div className="relative -mx-3 flex flex-col bg-[color-mix(in_srgb,var(--t-surface)_55%,transparent)] px-3 py-3">
			<div className="match-zone flex flex-col gap-1.5">
				<div className="flex items-center gap-1.5">
					<Label>Matching intent</Label>
					{!lockManualEntry && intentExamples && intentExamples.length > 0 && (
						<IntentExamplesPopover
							examples={intentExamples}
							onPick={(nextDescription, nextGenres) => {
								onDraftDescriptionChange(nextDescription);
								onDraftGenresChange([...nextGenres]);
							}}
						/>
					)}
				</div>
				{lockManualEntry && examplesSlot ? (
					// Two rows stacked in one grid: the picker (1fr) and the picked text
					// (0fr) trade places on pick, each fading as it collapses/expands. The
					// grid's height is always exactly the open row, so the text rises into
					// the space the examples vacate with no jump.
					<div className="grid">
						<div
							className="grid transition-[grid-template-rows,opacity] duration-[360ms] ease-[var(--ease-out-expo)] motion-reduce:transition-none"
							style={{
								gridTemplateRows: picked ? "0fr" : "1fr",
								opacity: picked ? 0 : 1,
							}}
							inert={picked}
						>
							<div className="min-h-0 overflow-hidden">{examplesSlot}</div>
						</div>
						<div
							className="grid transition-[grid-template-rows,opacity] duration-[360ms] ease-[var(--ease-out-expo)] motion-reduce:transition-none"
							style={{
								gridTemplateRows: picked ? "1fr" : "0fr",
								opacity: picked ? 1 : 0,
							}}
							inert={!picked}
						>
							<div className="min-h-0 overflow-hidden">{intentField}</div>
						</div>
					</div>
				) : (
					intentField
				)}
			</div>

			{/* z-10 keeps the genre search popover above the filter rows below it —
			    they're sibling subtrees, so without an explicit order the later
			    filter section can paint its chevrons over the open dropdown. */}
			<div className="match-zone xpl-genres xpl-reveal relative z-10 flex flex-col gap-2">
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
					disabled={isSaving || lockManualEntry}
					autoFocus={focusTargetRef.current === "genres"}
				/>
			</div>

			{advancedFilters && (
				// Reveals with the genre region (same entrance) since it too is new
				// in edit mode; a small delay cascades it just after genres so the
				// new editable regions arrive in reading order, not all at once.
				<div
					className="match-zone xpl-reveal relative z-0"
					style={{ animationDelay: "50ms" }}
				>
					{advancedFilters}
				</div>
			)}

			<div
				className="xpl-reveal flex flex-col gap-2 pt-4"
				style={{ animationDelay: "90ms" }}
			>
				{saveError && (
					<p
						role="alert"
						className="text-xs"
						style={{
							fontFamily: fonts.body,
							color: "var(--t-destructive, hsl(0 72% 51%))",
						}}
					>
						{saveError}
					</p>
				)}
				<div className="flex items-center justify-end gap-2">
					{!lockManualEntry && (
						<Button
							variant="ghost"
							size="sm"
							onClick={onCancel}
							disabled={isSaving}
							style={{ fontFamily: fonts.body }}
						>
							Cancel
						</Button>
					)}
					<Button
						size="sm"
						onClick={onSave}
						disabled={isSaving || (lockManualEntry && !draftDescription.trim())}
						// Guided mode: once an example is picked Save becomes the next
						// action, so breathe the same pulse as the add toggle to point the
						// user at it. Before a pick it's disabled, so it stays quiet.
						className={lockManualEntry && picked ? "xpl-pulse" : undefined}
						style={{ fontFamily: fonts.body }}
					>
						{isSaving ? "Saving…" : "Save"}
					</Button>
				</div>
			</div>
		</div>
	);
}
