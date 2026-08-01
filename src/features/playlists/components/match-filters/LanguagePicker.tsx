/**
 * LanguagePicker — trigger → floating command-palette popover.
 *
 * A compact trigger row (showing selected chips) opens a full-width overlay
 * with a search input at the top and a scrollable options list below.
 * Keyboard: Enter/Space opens, Arrow navigation, Enter selects, Escape closes.
 * No inline list visible until triggered — minimal footprint when collapsed.
 */

import { CaretDownIcon } from "@phosphor-icons/react";
import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	languageLabel,
	orderLanguageOptions,
	searchLanguages,
} from "@/lib/domains/taste/match-filters/languages";
import type {
	MatchFilterLanguageOption,
	PlaylistMatchFilterOptions,
} from "@/lib/domains/taste/match-filters/types";
import { fonts } from "@/lib/theme/fonts";
import { LanguageChips } from "./LanguageChips";
import { LanguageCommandPalette } from "./LanguageCommandPalette";
import "../playlist-ui.css";

export interface LanguagePickerProps {
	/** Selected language codes; pass a stable reference for an empty selection. */
	value: string[];
	onChange: (codes: string[]) => void;
	options: PlaylistMatchFilterOptions;
	disabled?: boolean;
	/**
	 * True while a save is in flight. Unlike `disabled` (options loading/error,
	 * where chips stay removable per §7), a pending save also freezes chip removal
	 * so a removal can't be lost when the save reconciles the submitted draft.
	 */
	isSaving?: boolean;
	/**
	 * Visually hide the built-in "Language" eyebrow when the picker is nested under
	 * a row that already names the facet. The label stays in the DOM (sr-only) so
	 * the trigger's aria-labelledby accessible name is preserved.
	 */
	hideLabel?: boolean;
	/** Whether the parent container (e.g. FacetRow Expand) is expanded. */
	expanded?: boolean;
}

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

export function LanguagePicker({
	value,
	onChange,
	options,
	disabled = false,
	isSaving = false,
	hideLabel = false,
	expanded = true,
}: LanguagePickerProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const [announcement, setAnnouncement] = useState("");

	const triggerRef = useRef<HTMLButtonElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const baseId = useId();
	const listboxId = `${baseId}-listbox`;
	const optionId = (i: number) => `${baseId}-opt-${i}`;

	const selectedCodes = value;
	const detectedCounts = useMemo(() => buildDetectedCounts(options), [options]);

	const orderedAll = useMemo(
		() => orderLanguageOptions(selectedCodes, detectedCounts),
		[selectedCodes, detectedCounts],
	);

	const displayOptions: MatchFilterLanguageOption[] = useMemo(() => {
		const q = query.trim();
		if (!q) return orderedAll;
		const results = searchLanguages(q);
		const selectedSet = new Set(selectedCodes);
		const sel = results.filter((o) => selectedSet.has(o.code));
		const rest = results.filter((o) => !selectedSet.has(o.code));
		return [...sel, ...rest];
	}, [query, orderedAll, selectedCodes]);

	const isEmpty = selectedCodes.length === 0;
	const paletteVisible = isEmpty || open;
	// Both `disabled` (options loading/error) and `isSaving` must freeze adding a
	// language — unlike chip removal, there's no §7 carve-out for the add path.
	// Matters most when empty: the palette is always rendered then (no trigger to
	// gate it), so this is the only guard standing between the user and a stale add.
	const frozen = disabled || isSaving;

	// Focus search when the palette is visible AND the parent container is expanded.
	// When empty the palette is always rendered, so `expanded` is the real trigger.
	useEffect(() => {
		if (paletteVisible && expanded) {
			const id = window.setTimeout(() => searchRef.current?.focus(), 16);
			return () => window.clearTimeout(id);
		}
		if (!paletteVisible) {
			triggerRef.current?.focus();
			setQuery("");
			setActiveIndex(0);
		}
	}, [paletteVisible, expanded]);

	// Close on outside click
	useEffect(() => {
		if (!open) return;
		const handler = (e: PointerEvent) => {
			if (!containerRef.current?.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener("pointerdown", handler);
		return () => document.removeEventListener("pointerdown", handler);
	}, [open]);

	const toggleCode = useCallback(
		(code: string) => {
			if (frozen) return;
			const isSelected = selectedCodes.includes(code);
			const remaining = isSelected
				? selectedCodes.filter((c) => c !== code)
				: [...selectedCodes, code];
			// Keep the palette open when adding the first language — without this
			// the palette would vanish (no longer isEmpty, open still false).
			if (!isSelected && selectedCodes.length === 0) setOpen(true);
			onChange(remaining);
			setAnnouncement(
				isSelected
					? `Removed ${languageLabel(code)}. ${remaining.length} languages selected.`
					: `Added ${languageLabel(code)}. ${remaining.length} languages selected.`,
			);
		},
		[frozen, onChange, selectedCodes],
	);

	const removeCode = useCallback(
		(code: string) => {
			const remaining = selectedCodes.filter((c) => c !== code);
			onChange(remaining);
			setAnnouncement(
				`Removed ${languageLabel(code)}. ${remaining.length} languages selected.`,
			);
		},
		[onChange, selectedCodes],
	);

	const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		// The input carries `disabled` while frozen, which already stops real
		// keystrokes; this guard is the defense-in-depth backstop.
		if (frozen) return;
		switch (e.key) {
			case "ArrowDown": {
				e.preventDefault();
				const next = Math.min(activeIndex + 1, displayOptions.length - 1);
				setActiveIndex(next);
				document
					.getElementById(optionId(next))
					?.scrollIntoView({ block: "nearest" });
				return;
			}
			case "ArrowUp": {
				e.preventDefault();
				const prev = Math.max(activeIndex - 1, 0);
				setActiveIndex(prev);
				document
					.getElementById(optionId(prev))
					?.scrollIntoView({ block: "nearest" });
				return;
			}
			case "Enter": {
				e.preventDefault();
				const target = displayOptions[activeIndex];
				if (target) toggleCode(target.code);
				return;
			}
			case "Escape": {
				e.preventDefault();
				setOpen(false);
				return;
			}
		}
	};

	const handleTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
		if ((e.key === "Enter" || e.key === " ") && !disabled) {
			e.preventDefault();
			setOpen(true);
		}
	};

	return (
		<div ref={containerRef} style={{ fontFamily: fonts.body }}>
			<div
				className={
					hideLabel
						? "sr-only"
						: "text-[11px] tracking-[0.08em] uppercase theme-text-muted mb-2"
				}
				id={`${baseId}-label`}
			>
				Language
			</div>

			<LanguageChips
				selectedCodes={selectedCodes}
				isSaving={isSaving}
				onRemove={removeCode}
			/>

			{/* When empty, skip the trigger and show the palette directly;
			    otherwise show the trigger button that opens it on click. */}
			{!isEmpty && (
				<button
					ref={triggerRef}
					type="button"
					aria-haspopup="listbox"
					aria-expanded={open}
					aria-labelledby={`${baseId}-label`}
					disabled={disabled}
					onClick={() => setOpen((o) => !o)}
					onKeyDown={handleTriggerKeyDown}
					className="w-full flex items-center gap-1.5 border border-transparent rounded-[8px] px-2.5 py-1.5 text-left theme-text focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)] disabled:opacity-50 cursor-pointer transition-[background-color] duration-150"
					style={{
						background:
							"oklch(from var(--t-surface) calc(l - 0.025) calc(c + 0.003) calc(h + 3))",
						// @ts-expect-error -- corner-shape not yet in CSS typings
						cornerShape: "squircle",
					}}
				>
					<span className="flex-1 min-h-[16px] flex items-center">
						<span className="text-xs theme-text-muted">Add one more</span>
					</span>
					<CaretDownIcon
						size={12}
						weight="regular"
						aria-hidden
						className={`shrink-0 theme-text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`}
					/>
				</button>
			)}

			{/* Command palette: always visible when empty, toggled via trigger otherwise */}
			{(isEmpty || open) && (
				<LanguageCommandPalette
					query={query}
					onQueryChange={setQuery}
					searchRef={searchRef}
					listboxId={listboxId}
					optionId={optionId}
					activeIndex={activeIndex}
					onActiveIndexChange={setActiveIndex}
					displayOptions={displayOptions}
					selectedCodes={selectedCodes}
					detectedCounts={detectedCounts}
					onToggleCode={toggleCode}
					onSearchKeyDown={handleSearchKeyDown}
					frozen={frozen}
				/>
			)}

			<div aria-live="polite" className="sr-only">
				{announcement}
			</div>
		</div>
	);
}
