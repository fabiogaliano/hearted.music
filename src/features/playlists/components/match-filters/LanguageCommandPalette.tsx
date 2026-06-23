import type { KeyboardEvent, RefObject } from "react";
import type { MatchFilterLanguageOption } from "@/lib/domains/taste/match-filters/types";

interface LanguageCommandPaletteProps {
	query: string;
	onQueryChange: (value: string) => void;
	searchRef: RefObject<HTMLInputElement | null>;
	listboxId: string;
	optionId: (i: number) => string;
	activeIndex: number;
	onActiveIndexChange: (index: number) => void;
	displayOptions: MatchFilterLanguageOption[];
	selectedCodes: string[];
	detectedCounts: Map<string, number>;
	onToggleCode: (code: string) => void;
	onSearchKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * The language picker's command-palette popover: a search input above a
 * scrollable, keyboard-navigable options list. Sits in normal flow as a
 * full-width overlay; the parent owns the open/close state and renders this only
 * while open.
 */
export function LanguageCommandPalette({
	query,
	onQueryChange,
	searchRef,
	listboxId,
	optionId,
	activeIndex,
	onActiveIndexChange,
	displayOptions,
	selectedCodes,
	detectedCounts,
	onToggleCode,
	onSearchKeyDown,
}: LanguageCommandPaletteProps) {
	return (
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
						onQueryChange(e.target.value);
						// Reset highlight to the top match as the result set
						// changes; the open/close effect resets on cleared query.
						onActiveIndexChange(0);
					}}
					onKeyDown={onSearchKeyDown}
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
								onClick={() => onToggleCode(opt.code)}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										onToggleCode(opt.code);
									}
								}}
								onPointerMove={() => onActiveIndexChange(index)}
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
	);
}
