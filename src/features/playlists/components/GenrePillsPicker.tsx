import {
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { fonts } from "@/lib/theme/fonts";
import {
	type GenreOption,
	searchGenres,
	suggestQuickPicks,
} from "../genre-options";

const DEFAULT_MAX_PILLS = 5;
const DROPDOWN_LIMIT = 12;
const SUGGESTION_LIMIT = 6;

interface GenrePillsPickerProps {
	/** Canonical pills, controlled by the caller. */
	value: string[];
	onChange: (next: string[]) => void;
	/** Account top genres (canonical) seeding the quick-pick suggestions. */
	topGenres?: readonly string[];
	maxPills?: number;
	disabled?: boolean;
	/** Focus the search input on mount (used when the field expands on demand). */
	autoFocus?: boolean;
}

/**
 * Genre engine for the writing surface. A capacity meter ("GENRES · 0/5") sits
 * above the selected chips, which share a row with a dashed "+ add genre" input
 * pill. The pill turns solid-valid while a query matches and red-invalid when it
 * doesn't, ghosts the top match inline for Tab/→ completion, and floats the full
 * ranked results in a popover. Quick-pick suggestions show when the pill is
 * empty. Ported from the signed-off genre-opt-in exploration.
 */
export function GenrePillsPicker({
	value,
	onChange,
	topGenres = [],
	maxPills = DEFAULT_MAX_PILLS,
	disabled = false,
	autoFocus = false,
}: GenrePillsPickerProps) {
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(-1);
	const [shake, setShake] = useState(false);
	const [announcement, setAnnouncement] = useState("");

	const containerRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const measureRef = useRef<HTMLSpanElement>(null);
	const shakeTimerRef = useRef<number | null>(null);

	const baseId = useId();
	const listboxId = `${baseId}-listbox`;
	const optionId = (index: number) => `${baseId}-option-${index}`;
	const chipId = (genre: string) => `${baseId}-chip-${genre}`;

	const selectedSet = useMemo(() => new Set(value), [value]);

	const results = useMemo(
		() => searchGenres(query, { exclude: selectedSet, limit: DROPDOWN_LIMIT }),
		[query, selectedSet],
	);

	const suggestions = useMemo(
		() =>
			suggestQuickPicks({
				topGenres,
				selected: value,
				limit: SUGGESTION_LIMIT,
			}),
		[topGenres, value],
	);

	const atCap = value.length >= maxPills;
	const trimmed = query.trim();
	const validity =
		trimmed === "" ? "idle" : results.length > 0 ? "valid" : "invalid";

	// The popover floats the ranked results; it stays mounted (so aria-controls
	// has a target and the open/close can transition) but only carries options
	// while the user is actively typing into the pill.
	const popOpen = open && trimmed !== "" && !atCap;

	// Inline autocomplete: the remainder of the top match when it prefixes the
	// query, rendered behind the caret for Tab/→ to accept.
	const ghost = useMemo(() => {
		if (trimmed === "") return "";
		const top = results[0]?.value;
		if (top?.toLowerCase().startsWith(query.toLowerCase())) {
			return top.slice(query.length);
		}
		return "";
	}, [trimmed, results, query]);

	const announce = useCallback((message: string) => {
		setAnnouncement(message);
	}, []);

	// Size the bare input to its content (or placeholder) so the dashed pill hugs
	// the text instead of reserving a fixed field width.
	const sizeInput = useCallback(() => {
		const input = inputRef.current;
		const measure = measureRef.current;
		if (!input || !measure) return;
		measure.textContent = input.value || input.placeholder;
		input.style.width = `${measure.offsetWidth + 2}px`;
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: query drives the re-measure; sizeInput reads the input via ref so the dep isn't statically visible
	useLayoutEffect(() => {
		sizeInput();
	}, [query, sizeInput]);

	// The hidden measure span only reports a correct width once the webfont has
	// loaded; without this the "add genre" placeholder clips to "add gen…" on the
	// first paint of a freshly-mounted picker.
	useEffect(() => {
		if (!document.fonts?.ready) return;
		void document.fonts.ready.then(sizeInput);
	}, [sizeInput]);

	const triggerShake = useCallback(() => {
		setShake(true);
		if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
		shakeTimerRef.current = window.setTimeout(() => setShake(false), 240);
	}, []);

	useEffect(() => {
		return () => {
			if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
		};
	}, []);

	const addGenre = useCallback(
		(genre: string) => {
			if (selectedSet.has(genre)) return;
			if (value.length >= maxPills) {
				triggerShake();
				announce(`Maximum ${maxPills} genres. Remove one to add another.`);
				return;
			}
			const next = [...value, genre];
			onChange(next);
			// Clear the query so the next search starts fresh — adding an unrelated
			// genre shouldn't require manually deleting the previous term.
			setQuery("");
			setOpen(false);
			setActiveIndex(-1);
			announce(`Added ${genre}. ${next.length} of ${maxPills} selected.`);
			inputRef.current?.focus();
		},
		[announce, maxPills, onChange, selectedSet, triggerShake, value],
	);

	const removeGenre = useCallback(
		(genre: string) => {
			const next = value.filter((g) => g !== genre);
			onChange(next);
			setActiveIndex(-1);
			announce(`Removed ${genre}. ${next.length} of ${maxPills} selected.`);
			inputRef.current?.focus();
		},
		[announce, maxPills, onChange, value],
	);

	// Focus the input when the field expands on demand, so the user can type
	// immediately without a second click. Mount-only by design.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only focus
	useEffect(() => {
		if (autoFocus) inputRef.current?.focus();
	}, []);

	// Keep the highlighted option scrolled into view as the user arrows through.
	useEffect(() => {
		if (activeIndex < 0 || !popOpen) return;
		document
			.getElementById(`${baseId}-option-${activeIndex}`)
			?.scrollIntoView({ block: "nearest" });
	}, [activeIndex, popOpen, baseId]);

	// Close the popover on any click outside the whole control.
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!containerRef.current?.contains(event.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [open]);

	const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const next = event.target.value;
		setQuery(next);
		setOpen(next.trim() !== "");
		// Results shift under the highlight as the query changes, so drop the
		// active descendant rather than let it point at a stale option.
		setActiveIndex(-1);
	};

	const acceptGhost = () => {
		const top = results[0];
		if (!top) return;
		setQuery(top.value);
		setOpen(true);
		setActiveIndex(-1);
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		const caretAtEnd =
			event.currentTarget.selectionStart === event.currentTarget.value.length;
		switch (event.key) {
			case "ArrowDown": {
				event.preventDefault();
				if (!popOpen) {
					setOpen(query.trim() !== "");
					setActiveIndex(results.length > 0 ? 0 : -1);
					return;
				}
				setActiveIndex((index) =>
					results.length === 0 ? -1 : Math.min(index + 1, results.length - 1),
				);
				return;
			}
			case "ArrowUp": {
				event.preventDefault();
				if (!popOpen) return;
				setActiveIndex((index) => Math.max(index - 1, 0));
				return;
			}
			case "ArrowRight":
			case "Tab": {
				// Accept the inline ghost completion when the caret sits at the end.
				if (ghost && caretAtEnd) {
					event.preventDefault();
					acceptGhost();
				}
				return;
			}
			case "Enter": {
				event.preventDefault();
				if (results.length > 0) {
					const target = results[activeIndex >= 0 ? activeIndex : 0];
					if (target) addGenre(target.value);
				} else if (trimmed !== "") {
					// No match for what was typed — nudge rather than add nothing.
					triggerShake();
				}
				return;
			}
			case "Escape": {
				if (popOpen) {
					// Swallow this Escape so it dismisses the suggestions first instead
					// of bubbling to the panel's document-level Escape-to-close. A second
					// Escape (popover now closed) falls through and reaches the panel.
					event.preventDefault();
					event.stopPropagation();
					setOpen(false);
					setActiveIndex(-1);
				}
				return;
			}
			case "Backspace": {
				if (query === "" && value.length > 0) {
					event.preventDefault();
					removeGenre(value[value.length - 1]);
				}
				return;
			}
		}
	};

	return (
		<div
			ref={containerRef}
			className="genre-picker"
			style={{ fontFamily: fonts.body }}
		>
			<div className="gp-meter">
				<span className="gp-label">Genres</span>
				<span className={`gp-count${atCap ? " cap" : ""}`}>
					{value.length}/{maxPills}
				</span>
			</div>

			{/* Selected chips share a wrapping row with the add-genre input pill, so
			    the control reads as one field that holds chips and a place to type. */}
			<div className="gp-chips">
				{value.map((genre) => (
					<span key={genre} id={chipId(genre)} className="gp-chip">
						<span>{genre}</span>
						<button
							type="button"
							className="gp-chip-x"
							onClick={() => removeGenre(genre)}
							disabled={disabled}
							aria-label={`Remove ${genre}`}
						>
							<span aria-hidden="true">×</span>
						</button>
					</span>
				))}

				{!atCap && (
					// A <label> gives native click-to-focus across the whole pill (the
					// "+" prefix and padding included) with no handler and no a11y lint;
					// the input's accessible name still comes from its own aria-label.
					<label
						className={`gp-pill${validity === "valid" ? " valid" : validity === "invalid" ? " invalid" : ""}${shake ? " shake" : ""}`}
						style={
							disabled ? { opacity: 0.6, pointerEvents: "none" } : undefined
						}
					>
						<span className="gp-pill-prefix" aria-hidden="true">
							+
						</span>
						<span className="gp-pill-field">
							<span
								ref={measureRef}
								className="gp-pill-measure"
								aria-hidden="true"
							/>
							<input
								ref={inputRef}
								type="text"
								role="combobox"
								aria-expanded={popOpen}
								aria-controls={listboxId}
								aria-autocomplete="list"
								aria-activedescendant={
									popOpen && activeIndex >= 0
										? optionId(activeIndex)
										: undefined
								}
								aria-label="Add genre"
								className="gp-pill-input"
								placeholder="add genre"
								value={query}
								onChange={handleInputChange}
								onKeyDown={handleKeyDown}
								onFocus={() => {
									if (query.trim() !== "") setOpen(true);
								}}
								disabled={disabled}
							/>
							<span className="gp-pill-ghost" aria-hidden="true">
								{ghost}
							</span>
						</span>
					</label>
				)}
			</div>

			{/* Quick picks yield to the search popover while the user is typing, so
			    the control doesn't show two competing discovery modes at once. */}
			{!open && !atCap && suggestions.length > 0 && (
				<div className="gp-suggestions">
					{suggestions.map((genre) => (
						<button
							key={genre}
							type="button"
							className="gp-opt enter"
							onClick={() => addGenre(genre)}
							disabled={disabled}
						>
							{genre}
						</button>
					))}
				</div>
			)}

			{!atCap && (
				<ul
					id={listboxId}
					// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: APG combobox keeps DOM focus on the input; the listbox is referenced via aria-controls/aria-activedescendant, so a styled <ul role=listbox> is the correct pattern here.
					role="listbox"
					aria-label="Genres"
					aria-hidden={!popOpen}
					className={`gp-pop${popOpen ? " open" : ""}`}
				>
					{popOpen &&
						(results.length > 0 ? (
							results.map((option, index) => (
								<GenreOptionRow
									key={option.value}
									id={optionId(index)}
									option={option}
									query={query}
									active={index === activeIndex}
									onSelect={() => addGenre(option.value)}
									onHover={() => setActiveIndex(index)}
								/>
							))
						) : (
							<li className="gp-opt-empty" role="presentation">
								No genre matches “{trimmed}”
							</li>
						))}
				</ul>
			)}

			<div aria-live="polite" className="sr-only">
				{announcement}
			</div>
		</div>
	);
}

function GenreOptionRow({
	id,
	option,
	query,
	active,
	onSelect,
	onHover,
}: {
	id: string;
	option: GenreOption;
	query: string;
	active: boolean;
	onSelect: () => void;
	onHover: () => void;
}) {
	return (
		<li role="presentation">
			{/* The option is a <button> so its interactive role carries native
			    keyboard + focus semantics; tabIndex=-1 keeps it out of the tab order
			    (focus stays on the combobox input via aria-activedescendant), and
			    onMouseDown preventDefault stops a click from pulling focus off the
			    input. */}
			<button
				type="button"
				id={id}
				role="option"
				aria-selected={active}
				tabIndex={-1}
				className={`gp-opt-row${active ? " active" : ""}`}
				onClick={onSelect}
				onMouseDown={(event) => event.preventDefault()}
				onPointerMove={onHover}
			>
				{/* One inline span keeps the label a single flex item — splitting the
				    highlight into sibling text nodes would let flex layout strip the
				    spaces between words ("alternative rock" → "alternativerock"). */}
				<span>{highlightMatch(option.value, query)}</span>
			</button>
		</li>
	);
}

// Highlights the first occurrence of the typed query inside the rendered
// (canonical) label. When the match came from a variant alias — e.g. "r&b"
// matching the chip whose value is "rnb" — there's nothing to highlight in the
// label, so the value renders plain.
function highlightMatch(value: string, query: string): ReactNode {
	const needle = query.trim().toLowerCase();
	if (needle === "") return value;
	const start = value.toLowerCase().indexOf(needle);
	if (start === -1) return value;
	const end = start + needle.length;
	return (
		<>
			{value.slice(0, start)}
			<mark>{value.slice(start, end)}</mark>
			{value.slice(end)}
		</>
	);
}
