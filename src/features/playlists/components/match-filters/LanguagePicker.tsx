/**
 * LanguagePicker — trigger → floating command-palette popover.
 *
 * A compact trigger row (showing selected chips) opens a full-width overlay
 * with a search input at the top and a scrollable options list below.
 * Keyboard: Enter/Space opens, Arrow navigation, Enter selects, Escape closes.
 * No inline list visible until triggered — minimal footprint when collapsed.
 */

import { CaretDownIcon, XIcon } from "@phosphor-icons/react";
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

			{/* Selected chips — sibling of trigger so browser does not suppress
			    pointer-events via disabled-button inheritance (decisions §7) */}
			{selectedCodes.length > 0 && (
				<ul
					className="m-0 list-none flex flex-wrap gap-1 p-0 mb-1.5"
					aria-label="Selected languages"
				>
					{selectedCodes.map((code) => (
						<li key={code}>
							<span className="mf-lang-chip xpl-chip-enter">
								<span className="text-[11px] leading-none tracking-[0.04em]">
									{languageLabel(code)}
								</span>
								<button
									type="button"
									onClick={() => removeCode(code)}
									disabled={isSaving}
									aria-label={`Remove ${languageLabel(code)} language`}
									className="mf-lang-chip-x"
								>
									<XIcon size={10} weight="bold" aria-hidden />
								</button>
							</span>
						</li>
					))}
				</ul>
			)}

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
				<div
					className="border theme-border-color theme-bg mt-1 xpl-reveal"
					style={{ boxShadow: "0 4px 16px rgba(0,0,0,0.10)" }}
				>
					{/* Search input */}
					<div className="border-b theme-border-color px-3 py-2">
						<input
							ref={searchRef}
							type="text"
							role="combobox"
							aria-label="Search languages"
							aria-expanded="true"
							aria-controls={listboxId}
							aria-autocomplete="list"
							aria-activedescendant={
								displayOptions.length > 0 ? optionId(activeIndex) : undefined
							}
							placeholder="Search languages…"
							value={query}
							onChange={(e) => {
								setQuery(e.target.value);
								// Reset highlight to the top match as the result set
								// changes; the open/close effect resets on cleared query.
								setActiveIndex(0);
							}}
							onKeyDown={handleSearchKeyDown}
							className="w-full border-0 bg-transparent text-sm theme-text placeholder:theme-text-muted focus-visible:outline-none"
						/>
					</div>

					{/* Options list. APG combobox pattern: focus on input, listbox navigated
					    via aria-activedescendant — div[role=listbox] is correct here. */}
					<div
						id={listboxId}
						role="listbox"
						aria-multiselectable="true"
						aria-label="Languages"
						className="overflow-y-auto"
						style={{ maxHeight: 240 }}
					>
						{displayOptions.length === 0 ? (
							<div
								role="presentation"
								className="px-3 py-3 text-sm theme-text-muted"
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
										tabIndex={-1}
										className={`flex items-center justify-between px-3 py-2.5 text-sm cursor-pointer transition-[background-color] duration-100 ${
											isActive
												? "bg-(--t-surface)"
												: isSelected
													? "bg-(--t-surface-dim)"
													: ""
										} theme-text`}
										onClick={() => toggleCode(opt.code)}
										onKeyDown={(e) => {
											if (e.key === "Enter" || e.key === " ") {
												e.preventDefault();
												toggleCode(opt.code);
											}
										}}
										onPointerMove={() => setActiveIndex(index)}
									>
										<span>{opt.label}</span>
										<span className="flex items-center gap-3">
											{count !== undefined && (
												<span className="text-[11px] tabular-nums theme-text-muted">
													{count} songs
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
				</div>
			)}

			<div aria-live="polite" className="sr-only">
				{announcement}
			</div>
		</div>
	);
}
