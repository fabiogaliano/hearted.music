/**
 * Direction C — Two-pane inline: detected left, catalog-search right.
 *
 * The control splits into two columns: left shows detected languages (with
 * counts) as quick-select buttons, right shows a live-search input + scrollable
 * catalog that includes both detected and catalog-only results. Selected
 * languages appear as chips above both panes. This model makes the most of
 * horizontal space and separates the "your library" context from the full
 * catalog without requiring a popover to open.
 *
 * Keyboard: Tab navigates between panes, Arrow keys navigate within the
 * catalog list, Enter/Space toggles selection, Backspace removes last chip.
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

/** Sorted detected entries from options, already in count-desc order. */
function buildDetectedOptions(
	options: PlaylistMatchFilterOptions,
): Array<{ code: string; label: string; count: number }> {
	return options.languages
		.filter((l) => l.source === "detected")
		.sort((a, b) => b.count - a.count)
		.map((l) => ({
			code: l.code,
			// Canonical label from catalog so both panes show the same string
			label: languageLabel(l.code) ?? l.label,
			count: l.count,
		}));
}

export function LanguagePickerInline({
	filters,
	onFiltersChange,
	options,
	disabled = false,
}: LanguagePickerProps) {
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(-1);
	const [announcement, setAnnouncement] = useState("");

	const searchRef = useRef<HTMLInputElement>(null);
	const baseId = useId();
	const listboxId = `${baseId}-catalog`;
	const optionId = (i: number) => `${baseId}-opt-${i}`;

	const selectedCodes = filters.languages?.codes ?? [];
	const detectedCounts = useMemo(() => buildDetectedCounts(options), [options]);
	const detectedOptions = useMemo(
		() => buildDetectedOptions(options),
		[options],
	);

	// Right-pane catalog: search-filtered or full ordered list
	const catalogOptions: MatchFilterLanguageOption[] = useMemo(() => {
		const q = query.trim();
		if (!q) return orderLanguageOptions(selectedCodes, detectedCounts);
		const results = searchLanguages(q);
		const selectedSet = new Set(selectedCodes);
		return [
			...results.filter((o) => selectedSet.has(o.code)),
			...results.filter((o) => !selectedSet.has(o.code)),
		];
	}, [query, selectedCodes, detectedCounts]);

	const announce = useCallback((msg: string) => setAnnouncement(msg), []);

	const addCode = useCallback(
		(code: string) => {
			if (selectedCodes.includes(code)) return;
			const next = normalizeMatchFilters({
				...filters,
				languages: { codes: [...selectedCodes, code] },
			});
			onFiltersChange(next);
			announce(
				`Added ${languageLabel(code)}. ${selectedCodes.length + 1} languages selected.`,
			);
		},
		[filters, onFiltersChange, selectedCodes, announce],
	);

	const removeCode = useCallback(
		(code: string) => {
			const remaining = selectedCodes.filter((c) => c !== code);
			const next = normalizeMatchFilters({
				...filters,
				languages: remaining.length > 0 ? { codes: remaining } : undefined,
			});
			onFiltersChange(next);
			announce(
				`Removed ${languageLabel(code)}. ${remaining.length} languages selected.`,
			);
			searchRef.current?.focus();
		},
		[filters, onFiltersChange, selectedCodes, announce],
	);

	const toggleCode = useCallback(
		(code: string) => {
			if (selectedCodes.includes(code)) {
				removeCode(code);
			} else {
				addCode(code);
			}
		},
		[selectedCodes, addCode, removeCode],
	);

	const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		switch (e.key) {
			case "ArrowDown": {
				e.preventDefault();
				const next = Math.min(activeIndex + 1, catalogOptions.length - 1);
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
				const target = catalogOptions[activeIndex >= 0 ? activeIndex : 0];
				if (target) toggleCode(target.code);
				return;
			}
			case "Backspace": {
				if (query === "" && selectedCodes.length > 0) {
					e.preventDefault();
					removeCode(selectedCodes[selectedCodes.length - 1]);
				}
				return;
			}
			case "Escape": {
				e.preventDefault();
				setQuery("");
				setActiveIndex(-1);
				return;
			}
		}
	};

	return (
		<div style={{ fontFamily: fonts.body }}>
			<div
				className="text-[11px] tracking-[0.08em] uppercase theme-text-muted mb-2"
				id={`${baseId}-label`}
			>
				Language
			</div>

			{/* Selected chips row */}
			{selectedCodes.length > 0 && (
				<ul
					className="m-0 list-none flex flex-wrap gap-1 p-0 mb-3"
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
									aria-label={`Remove ${languageLabel(code)} language`}
									className="-mr-0.5 grid size-[16px] shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 theme-text-muted transition-[color] duration-150 hover:theme-text active:scale-[0.9]"
								>
									<XIcon size={9} weight="bold" aria-hidden />
								</button>
							</span>
						</li>
					))}
				</ul>
			)}

			{/* Two-pane layout */}
			<div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1.4fr" }}>
				{/* Left pane — detected from library */}
				<div>
					<div className="text-[10px] tracking-[0.08em] uppercase theme-text-muted mb-1.5">
						In your library
					</div>
					{detectedOptions.length === 0 ? (
						<p className="text-xs theme-text-muted">No detected languages</p>
					) : (
						<ul className="m-0 list-none p-0 flex flex-col gap-0.5">
							{detectedOptions.map((lang) => {
								const isSelected = selectedCodes.includes(lang.code);
								return (
									<li key={lang.code}>
										<button
											type="button"
											onClick={() => toggleCode(lang.code)}
											disabled={disabled}
											aria-pressed={isSelected}
											className={`w-full flex items-center justify-between px-2.5 py-1.5 text-sm transition-[background-color,color] duration-100 text-left disabled:opacity-50 ${
												isSelected
													? "bg-(--t-surface-dim) theme-text"
													: "theme-text-muted hover:bg-(--t-surface) hover:theme-text"
											}`}
										>
											<span>{lang.label}</span>
											<span className="flex items-center gap-2">
												<span className="text-[11px] tabular-nums theme-text-muted">
													{lang.count}
												</span>
												{isSelected && (
													<span
														className="text-[10px]"
														style={{ color: "var(--t-primary)" }}
														aria-hidden
													>
														✓
													</span>
												)}
											</span>
										</button>
									</li>
								);
							})}
						</ul>
					)}
				</div>

				{/* Right pane — full catalog with search */}
				<div className="flex flex-col gap-1.5 border-l pl-3 theme-border-color">
					<div className="text-[10px] tracking-[0.08em] uppercase theme-text-muted mb-0.5">
						All languages
					</div>
					<input
						ref={searchRef}
						type="text"
						role="combobox"
						aria-expanded="true"
						aria-controls={listboxId}
						aria-autocomplete="list"
						aria-activedescendant={
							activeIndex >= 0 ? optionId(activeIndex) : undefined
						}
						aria-labelledby={`${baseId}-label`}
						placeholder="Search…"
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setActiveIndex(-1);
						}}
						onKeyDown={handleSearchKeyDown}
						disabled={disabled}
						className="border px-2.5 py-1.5 text-sm theme-border-color theme-bg theme-text placeholder:theme-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)] disabled:opacity-50"
					/>
					{/* APG combobox: focus stays on input, catalog navigated via
					    aria-activedescendant — div[role=listbox] is correct here. */}
					<div
						id={listboxId}
						role="listbox"
						aria-multiselectable="true"
						aria-label="All languages"
						className="overflow-y-auto flex-1"
						style={{ maxHeight: 180 }}
					>
						{catalogOptions.length === 0 ? (
							<div
								role="presentation"
								className="py-2 text-sm theme-text-muted"
							>
								No languages match &ldquo;{query.trim()}&rdquo;
							</div>
						) : (
							catalogOptions.map((opt, index) => {
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
										className={`flex items-center justify-between px-2 py-1.5 text-sm cursor-pointer transition-[background-color] duration-100 ${
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
										<span className="flex items-center gap-2">
											{count !== undefined && (
												<span className="text-[10px] tabular-nums theme-text-muted">
													{count}
												</span>
											)}
											{isSelected && (
												<span
													className="text-[10px]"
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
			</div>

			<div aria-live="polite" className="sr-only">
				{announcement}
			</div>
		</div>
	);
}
