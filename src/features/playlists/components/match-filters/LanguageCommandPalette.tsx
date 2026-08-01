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
	/**
	 * True while options are loading/erroring or a save is in flight. The
	 * empty-selection state renders this palette unconditionally (no trigger to
	 * gate it), so it's the only place standing between the user and editing
	 * against stale options or a save that's about to reconcile the draft.
	 */
	frozen?: boolean;
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
	frozen = false,
}: LanguageCommandPaletteProps) {
	return (
		<div
			className="border border-transparent rounded-[10px] mt-1 xpl-reveal overflow-hidden"
			style={{
				background:
					"oklch(from var(--t-surface) calc(l - 0.012) calc(c + 0.002) calc(h + 2))",
				// @ts-expect-error -- corner-shape not yet in CSS typings
				cornerShape: "squircle",
			}}
		>
			{/* Search input */}
			<div
				className="border-b border-transparent px-2.5 py-1.5"
				style={{
					borderBottomColor:
						"oklch(from var(--t-surface) calc(l - 0.06) c h / 0.3)",
				}}
			>
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
					disabled={frozen}
					onChange={(e) => {
						if (frozen) return;
						onQueryChange(e.target.value);
						onActiveIndexChange(0);
					}}
					onKeyDown={onSearchKeyDown}
					className="w-full border-0 bg-transparent text-xs theme-text placeholder:theme-text-muted focus-visible:outline-none disabled:opacity-50"
				/>
			</div>

			{/* Options list. APG combobox pattern: focus on input, listbox navigated
			    via aria-activedescendant — div[role=listbox] is correct here. */}
			<div
				id={listboxId}
				role="listbox"
				aria-multiselectable="true"
				aria-label="Languages"
				aria-disabled={frozen}
				className="overflow-y-auto"
				style={{
					maxHeight: 180,
					opacity: frozen ? 0.5 : 1,
					pointerEvents: frozen ? "none" : undefined,
				}}
			>
				{displayOptions.length === 0 ? (
					<div
						role="presentation"
						className="px-2.5 py-2 text-xs theme-text-muted"
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
								aria-disabled={frozen}
								tabIndex={-1}
								className={`flex items-center justify-between px-2.5 py-1.5 text-xs transition-[background-color] duration-100 theme-text ${frozen ? "cursor-default" : "cursor-pointer"}`}
								style={{
									background: isActive
										? "oklch(from var(--t-surface) calc(l - 0.04) calc(c + 0.005) calc(h + 5))"
										: isSelected
											? "oklch(from var(--t-surface) calc(l - 0.03) calc(c + 0.003) calc(h + 3))"
											: "transparent",
								}}
								onClick={() => {
									if (frozen) return;
									onToggleCode(opt.code);
								}}
								onKeyDown={(e) => {
									if (frozen) return;
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										onToggleCode(opt.code);
									}
								}}
								onPointerMove={() => {
									if (frozen) return;
									onActiveIndexChange(index);
								}}
							>
								<span>{opt.label}</span>
								<span className="flex items-center gap-2.5">
									{count !== undefined && (
										<span className="text-[10px] tabular-nums theme-text-muted">
											{count} songs
										</span>
									)}
									{isSelected && (
										<span
											className="text-[9px] tracking-[0.06em] uppercase"
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
