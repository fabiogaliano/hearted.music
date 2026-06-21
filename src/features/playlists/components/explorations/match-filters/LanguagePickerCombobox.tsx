/**
 * Direction A — Inline combobox with typeahead.
 *
 * A single input field sits above a persistent scrollable list. Typing filters
 * the list live; selected items render as chips above the input. The list
 * is always visible (no popover to open) so the user can see all options at
 * once and scan before typing. APG combobox pattern with aria-activedescendant.
 */

import { XIcon } from "@phosphor-icons/react";
import {
	type KeyboardEvent,
	useCallback,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { languageLabel } from "@/lib/domains/taste/match-filters/labels";
import {
	orderLanguageOptions,
	searchLanguages,
} from "@/lib/domains/taste/match-filters/languages";
import { normalizeMatchFilters } from "@/lib/domains/taste/match-filters/normalizers";
import type {
	MatchFilterLanguageOption,
	PlaylistMatchFilterOptions,
	PlaylistMatchFiltersV1,
} from "@/lib/domains/taste/match-filters/types";
import { fonts } from "@/lib/theme/fonts";
import "../playlist-explorations.css";

export interface LanguagePickerProps {
	filters: PlaylistMatchFiltersV1;
	onFiltersChange: (next: PlaylistMatchFiltersV1) => void;
	options: PlaylistMatchFilterOptions;
	disabled?: boolean;
	/**
	 * True while a save is in flight. Unlike `disabled` (options loading/error,
	 * where chips stay removable per §7), a pending save also freezes chip removal
	 * so a removal can't be lost when the save reconciles the submitted draft.
	 */
	isSaving?: boolean;
}

/** Map from PlaylistMatchFilterOptions to the Map shape orderLanguageOptions expects. */
function buildDetectedCounts(
	options: PlaylistMatchFilterOptions,
): Map<string, number> {
	const map = new Map<string, number>();
	for (const lang of options.languages) {
		if (lang.source === "detected") {
			map.set(lang.code, lang.count);
		}
	}
	return map;
}

export function LanguagePickerCombobox({
	filters,
	onFiltersChange,
	options,
	disabled = false,
	isSaving = false,
}: LanguagePickerProps) {
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(-1);
	const [announcement, setAnnouncement] = useState("");

	const inputRef = useRef<HTMLInputElement>(null);
	const baseId = useId();
	const listboxId = `${baseId}-listbox`;
	// Memoized so it can be used as a stable useCallback dependency
	const optionId = useCallback(
		(index: number) => `${baseId}-opt-${index}`,
		[baseId],
	);

	const selectedCodes = filters.languages?.codes ?? [];
	const detectedCounts = useMemo(() => buildDetectedCounts(options), [options]);

	// Full ordered list for when there's no search query
	const orderedAll = useMemo(
		() => orderLanguageOptions(selectedCodes, detectedCounts),
		[selectedCodes, detectedCounts],
	);

	// When typing, search the catalog then re-order (selected first within results)
	const displayOptions: MatchFilterLanguageOption[] = useMemo(() => {
		const q = query.trim();
		if (!q) return orderedAll;
		const searchResults = searchLanguages(q);
		const selectedSet = new Set(selectedCodes);
		const sel = searchResults.filter((o) => selectedSet.has(o.code));
		const rest = searchResults.filter((o) => !selectedSet.has(o.code));
		return [...sel, ...rest];
	}, [query, orderedAll, selectedCodes]);

	const announce = useCallback((msg: string) => setAnnouncement(msg), []);

	const addCode = useCallback(
		(code: string) => {
			// While options are loading/error, adding from the catalog is disabled —
			// only chip removal of already-selected codes stays live (decisions §7).
			if (disabled) return;
			if (selectedCodes.includes(code)) return;
			const next = normalizeMatchFilters({
				...filters,
				languages: { codes: [...selectedCodes, code] },
			});
			onFiltersChange(next);
			announce(
				`Added ${languageLabel(code)}. ${selectedCodes.length + 1} languages selected.`,
			);
			inputRef.current?.focus();
		},
		[disabled, filters, onFiltersChange, selectedCodes, announce],
	);

	const removeCode = useCallback(
		(code: string) => {
			// Chips stay removable while options load/error, but a pending save
			// freezes removal so the edit isn't lost on reconcile.
			if (isSaving) return;
			const remaining = selectedCodes.filter((c) => c !== code);
			const next = normalizeMatchFilters({
				...filters,
				languages: remaining.length > 0 ? { codes: remaining } : undefined,
			});
			onFiltersChange(next);
			announce(
				`Removed ${languageLabel(code)}. ${remaining.length} languages selected.`,
			);
			inputRef.current?.focus();
		},
		[isSaving, filters, onFiltersChange, selectedCodes, announce],
	);

	const toggleCode = useCallback(
		(code: string) => {
			// The listbox routes both add and remove through toggle; disable it
			// wholesale so the option list can't mutate filters while options are
			// loading/error. Existing selections are still removable via their chips.
			if (disabled) return;
			if (selectedCodes.includes(code)) {
				removeCode(code);
			} else {
				addCode(code);
			}
		},
		[disabled, selectedCodes, addCode, removeCode],
	);

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		switch (event.key) {
			case "ArrowDown": {
				event.preventDefault();
				setActiveIndex((i) =>
					displayOptions.length === 0
						? -1
						: Math.min(i + 1, displayOptions.length - 1),
				);
				return;
			}
			case "ArrowUp": {
				event.preventDefault();
				setActiveIndex((i) => Math.max(i - 1, 0));
				return;
			}
			case "Enter": {
				event.preventDefault();
				const target = displayOptions[activeIndex >= 0 ? activeIndex : 0];
				if (target) toggleCode(target.code);
				return;
			}
			case "Backspace": {
				if (query === "" && selectedCodes.length > 0) {
					event.preventDefault();
					removeCode(selectedCodes[selectedCodes.length - 1]);
				}
				return;
			}
			case "Escape": {
				event.preventDefault();
				setQuery("");
				setActiveIndex(-1);
				return;
			}
		}
	};

	const handleActiveChange = useCallback(
		(index: number) => {
			setActiveIndex(index);
			document
				.getElementById(optionId(index))
				?.scrollIntoView({ block: "nearest" });
		},
		[optionId],
	);

	return (
		<div style={{ fontFamily: fonts.body }}>
			<div
				className="text-[11px] tracking-[0.08em] uppercase theme-text-muted mb-2"
				id={`${baseId}-label`}
			>
				Language
			</div>

			{/* Selected chips */}
			{selectedCodes.length > 0 && (
				<ul
					className="m-0 list-none flex flex-wrap gap-1 p-0 mb-2"
					aria-label="Selected languages"
				>
					{selectedCodes.map((code) => (
						<li key={code}>
							<span className="inline-flex items-center gap-1 rounded-full border bg-(--t-surface-dim) px-2.5 py-0.5 theme-border-color xpl-chip-enter">
								<span className="text-[11px] leading-none tracking-[0.04em] theme-text">
									{languageLabel(code)}
								</span>
								<button
									type="button"
									onClick={() => removeCode(code)}
									disabled={isSaving}
									aria-label={`Remove ${languageLabel(code)} language`}
									className="-mr-0.5 grid size-[16px] shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 theme-text-muted transition-[color,opacity] duration-150 hover:theme-text active:scale-[0.9] disabled:cursor-default disabled:opacity-50"
								>
									<XIcon size={9} weight="bold" aria-hidden />
								</button>
							</span>
						</li>
					))}
				</ul>
			)}

			{/* Search input — combobox controls the listbox below */}
			<input
				ref={inputRef}
				type="text"
				role="combobox"
				aria-expanded="true"
				aria-controls={listboxId}
				aria-autocomplete="list"
				aria-activedescendant={
					activeIndex >= 0 ? optionId(activeIndex) : undefined
				}
				aria-labelledby={`${baseId}-label`}
				placeholder="Search languages…"
				value={query}
				onChange={(e) => {
					setQuery(e.target.value);
					setActiveIndex(-1);
				}}
				onKeyDown={handleKeyDown}
				disabled={disabled}
				className="w-full border rounded-sm px-3 py-1.5 text-sm theme-border-color theme-bg theme-text placeholder:theme-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)] disabled:opacity-50"
			/>

			{/* Always-visible option list. APG combobox keeps DOM focus on the input;
			    the listbox is referenced via aria-controls/aria-activedescendant, so
			    a div[role=listbox] is the correct ARIA pattern here — matching the
			    same approach used in GenrePillsPicker. */}
			<div
				id={listboxId}
				role="listbox"
				aria-multiselectable="true"
				aria-disabled={disabled || undefined}
				aria-label="Languages"
				className={`mt-1 border theme-border-color overflow-y-auto ${
					disabled ? "opacity-50" : ""
				}`}
				style={{ maxHeight: 220 }}
			>
				{displayOptions.length === 0 ? (
					<div
						role="presentation"
						className="px-3 py-2.5 text-sm theme-text-muted"
					>
						No languages match &ldquo;{query.trim()}&rdquo;
					</div>
				) : (
					displayOptions.map((opt, index) => {
						const isSelected = selectedCodes.includes(opt.code);
						const isActive = index === activeIndex;
						const count = detectedCounts.get(opt.code);
						return (
							<div
								key={opt.code}
								id={optionId(index)}
								role="option"
								aria-selected={isSelected}
								aria-disabled={disabled || undefined}
								tabIndex={-1}
								className={`flex items-center justify-between px-3 py-2 text-sm transition-[background-color] duration-100 ${
									disabled ? "cursor-not-allowed" : "cursor-pointer"
								} ${
									isActive
										? "bg-(--t-surface)"
										: isSelected
											? "bg-(--t-surface-dim)"
											: ""
								} theme-text`}
								onClick={disabled ? undefined : () => toggleCode(opt.code)}
								onKeyDown={
									disabled
										? undefined
										: (e) => {
												if (e.key === "Enter" || e.key === " ") {
													e.preventDefault();
													toggleCode(opt.code);
												}
											}
								}
								onPointerMove={
									disabled ? undefined : () => handleActiveChange(index)
								}
							>
								<span>{opt.label}</span>
								<span className="flex items-center gap-2">
									{count !== undefined && (
										<span className="text-[11px] tabular-nums theme-text-muted">
											{count}
										</span>
									)}
									{isSelected && (
										<span
											className="text-[10px] tracking-[0.06em] uppercase"
											style={{ color: "var(--t-primary)" }}
											aria-hidden
										>
											✓
										</span>
									)}
								</span>
							</div>
						);
					})
				)}
			</div>

			<div aria-live="polite" className="sr-only">
				{announcement}
			</div>
		</div>
	);
}
