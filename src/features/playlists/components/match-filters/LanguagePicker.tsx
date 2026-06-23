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

	// Focus search when palette opens; restore trigger focus on close
	useEffect(() => {
		if (open) {
			const id = window.setTimeout(() => searchRef.current?.focus(), 16);
			return () => window.clearTimeout(id);
		}
		triggerRef.current?.focus();
		setQuery("");
		setActiveIndex(0);
	}, [open]);

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
			const isSelected = selectedCodes.includes(code);
			const remaining = isSelected
				? selectedCodes.filter((c) => c !== code)
				: [...selectedCodes, code];
			onChange(remaining);
			setAnnouncement(
				isSelected
					? `Removed ${languageLabel(code)}. ${remaining.length} languages selected.`
					: `Added ${languageLabel(code)}. ${remaining.length} languages selected.`,
			);
		},
		[onChange, selectedCodes],
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

			{/* Trigger: caret + placeholder only — no selected chips inside */}
			<button
				ref={triggerRef}
				type="button"
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-labelledby={`${baseId}-label`}
				disabled={disabled}
				onClick={() => setOpen(true)}
				onKeyDown={handleTriggerKeyDown}
				className="w-full flex items-center gap-2 border px-3 py-2 text-left theme-border-color theme-bg theme-text focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)] disabled:opacity-50 cursor-pointer transition-[background-color] duration-100 hover:bg-(--t-surface)"
			>
				<span className="flex-1 min-h-[20px] flex items-center">
					<span className="text-sm theme-text-muted">
						{selectedCodes.length === 0
							? "Add language…"
							: `${selectedCodes.length} selected — click to edit`}
					</span>
				</span>
				<CaretDownIcon
					size={14}
					weight="regular"
					aria-hidden
					className={`shrink-0 theme-text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`}
				/>
			</button>

			{/* Command palette popover — sits in normal flow (full-width overlay) */}
			{open && (
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
				/>
			)}

			<div aria-live="polite" className="sr-only">
				{announcement}
			</div>
		</div>
	);
}
