/**
 * ArtistConfig — the studio's multi-artist selection panel (sidebar, next to
 * Genre/Filters).
 *
 * Search input on top (type to find one of your liked artists), chips below.
 * Default (no search): active chips first, then inactive, each group sorted by
 * like-count desc. While searching the grouping disappears — a flat result
 * list where toggling an unselected artist adds+enables it, so search unifies
 * "add" and "activate". Chip body toggles enable/disable (dim), ✕ removes
 * outright (no confirm dialog and no undo: an unsaved draft artist you can
 * re-add via search is not a destructive loss). Inline chips are capped; beyond that a
 * "+N more" affordance opens a dialog managing the full set with the same
 * sorting and search-collapses-grouping behavior.
 *
 * Song counts on chips are an artist's TOTAL liked-song count from the draft
 * hook (null while resolving → shown as a pending "…"). They are deliberately
 * filter-independent: an anchor artist is a filter-exempt pin, so its songs (and
 * this count) survive filter changes rather than shrinking to what filters allow.
 *
 * If the resolution query fails outright, the counts would otherwise stay
 * pending forever with no explanation (and Create would silently drop every
 * selected artist's songs — CreateBar blocks on isResolutionError for that
 * reason). This panel surfaces the failure inline with a retry, since it's
 * where the affected chips live.
 */

import { XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import {
	type KeyboardEvent,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { scrollListElementIntoView } from "@/lib/keyboard/listScroll";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { fonts } from "@/lib/theme/fonts";
import { likedArtistSearchQueryOptions } from "../queries";
import type { ArtistSelectionVM } from "../useCreatePlaylistDraft";

// Chips visible inline before the overflow dialog takes over. Sized for a
// ~300px sidebar column: enough to see a real selection, small enough that a
// large set doesn't push the other config panels off screen.
const INLINE_CHIP_CAP = 8;
const BROWSE_RESULT_LIMIT = 50;
const SEARCH_RESULT_LIMIT = 8;
const SEARCH_DEBOUNCE_MS = 300;

interface ArtistConfigProps {
	selections: ArtistSelectionVM[];
	onAddArtist: (name: string) => void;
	onToggleArtist: (name: string) => void;
	onRemoveArtist: (name: string) => void;
	/** Focus the search input on mount (seed-card "+" lands here, ready for #2). */
	autoFocusSearch?: boolean;
	/** True when the song resolution for the current selection failed. */
	isResolutionError: boolean;
	/** Re-fetches the failed resolution — the only recovery path short of removing every chip. */
	onRetryResolution: () => void;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState<T>(value);
	useEffect(() => {
		const id = window.setTimeout(() => setDebounced(value), delayMs);
		return () => window.clearTimeout(id);
	}, [value, delayMs]);
	return debounced;
}

/** Active first, then inactive; within each group by like-count desc. */
function sortSelections(
	selections: ArtistSelectionVM[],
	likeCounts: Map<string, number>,
): ArtistSelectionVM[] {
	return [...selections].sort((a, b) => {
		if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
		return (
			(likeCounts.get(b.name) ?? 0) - (likeCounts.get(a.name) ?? 0) ||
			a.name.localeCompare(b.name)
		);
	});
}

export function ArtistConfig({
	selections,
	onAddArtist,
	onToggleArtist,
	onRemoveArtist,
	autoFocusSearch = false,
	isResolutionError,
	onRetryResolution,
}: ArtistConfigProps) {
	const [query, setQuery] = useState("");
	const [expanded, setExpanded] = useState(false);
	const [overflowOpen, setOverflowOpen] = useState(false);
	// Combobox pattern (APG): focus stays on the search input; the browse/search
	// list is a role="listbox" of non-tabbable role="option"s navigated via this
	// index + aria-activedescendant. Even the capped browse set should remain one
	// keyboard interaction rather than dozens of individual Tab stops.
	const [activeIndex, setActiveIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const baseId = useId();
	const listboxId = `${baseId}-listbox`;
	const optionId = (i: number) => `${baseId}-option-${i}`;

	// Closing via Escape/✕ returns focus to the trigger (it re-renders in the
	// same slot); an outside click leaves focus wherever the user clicked —
	// stealing it back there would fight the user's actual intent.
	const closeSearch = () => {
		setExpanded(false);
		setQuery("");
		setActiveIndex(0);
		requestAnimationFrame(() => triggerRef.current?.focus());
	};

	useEffect(() => {
		if (!expanded) return;
		const handler = (e: PointerEvent) => {
			if (!containerRef.current?.contains(e.target as Node)) {
				setExpanded(false);
				setQuery("");
			}
		};
		document.addEventListener("pointerdown", handler);
		return () => document.removeEventListener("pointerdown", handler);
	}, [expanded]);

	const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
	const isSearching = query.trim().length > 0;

	// The empty-query aggregate doubles as the like-count source for sorting;
	// it's the same cache entry the browse mode would use.
	const { data: browseData } = useQuery(likedArtistSearchQueryOptions(""));
	const { data: searchData, isFetching: isSearchFetching } = useQuery({
		...likedArtistSearchQueryOptions(debouncedQuery),
		enabled: debouncedQuery.length > 0,
	});

	const likeCounts = useMemo(
		() => new Map((browseData?.artists ?? []).map((a) => [a.name, a.count])),
		[browseData],
	);

	const selectionByName = useMemo(
		() => new Map(selections.map((s) => [s.name, s])),
		[selections],
	);

	const sortedSelections = useMemo(
		() => sortSelections(selections, likeCounts),
		[selections, likeCounts],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only focus
	useEffect(() => {
		if (autoFocusSearch) {
			setExpanded(true);
			inputRef.current?.focus();
		}
	}, []);

	useEffect(() => {
		if (expanded) {
			const id = window.setTimeout(() => inputRef.current?.focus(), 16);
			return () => window.clearTimeout(id);
		}
	}, [expanded]);

	const searchResults = (searchData?.artists ?? []).slice(
		0,
		SEARCH_RESULT_LIMIT,
	);
	const browseResults = useMemo(
		() => (browseData?.artists ?? []).slice(0, BROWSE_RESULT_LIMIT),
		[browseData],
	);

	// Browsing shows a useful top slice instead of mounting the server's full
	// 1,000-artist aggregate. Typed search still reaches the complete population.
	const artists = isSearching ? searchResults : browseResults;

	const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		switch (e.key) {
			case "Escape":
				closeSearch();
				return;
			case "ArrowDown": {
				if (artists.length === 0) return;
				e.preventDefault();
				const next = Math.min(activeIndex + 1, artists.length - 1);
				setActiveIndex(next);
				const el = document.getElementById(optionId(next));
				if (el) scrollListElementIntoView(el, "nearest");
				return;
			}
			case "ArrowUp": {
				if (artists.length === 0) return;
				e.preventDefault();
				const prev = Math.max(activeIndex - 1, 0);
				setActiveIndex(prev);
				const el = document.getElementById(optionId(prev));
				if (el) scrollListElementIntoView(el, "nearest");
				return;
			}
			case "Enter": {
				const target = artists[activeIndex];
				if (!target) return;
				e.preventDefault();
				const selection = selectionByName.get(target.name);
				if (selection) onToggleArtist(target.name);
				else onAddArtist(target.name);
				return;
			}
		}
	};

	const inlineChips = sortedSelections.slice(0, INLINE_CHIP_CAP);
	const overflowCount = sortedSelections.length - inlineChips.length;

	return (
		<div
			ref={containerRef}
			className="flex flex-col gap-2"
			style={{ fontFamily: fonts.body }}
		>
			<span className="theme-text-muted text-[10px] tracking-[0.16em] uppercase">
				Artists
			</span>

			{!expanded && (
				<button
					ref={triggerRef}
					type="button"
					onClick={() => {
						setExpanded(true);
						setActiveIndex(0);
					}}
					className="w-full flex items-center gap-1.5 border border-transparent rounded-[8px] px-2.5 py-1.5 text-left theme-text cursor-pointer transition-[background-color] duration-150"
					style={{
						background:
							"oklch(from var(--t-surface) calc(l - 0.025) calc(c + 0.003) calc(h + 3))",
						// @ts-expect-error -- corner-shape not yet in CSS typings
						cornerShape: "squircle",
					}}
				>
					<span className="flex-1 text-xs theme-text-muted">
						{selections.length > 0
							? `${selections.filter((s) => s.enabled).length} selected`
							: "Find a liked artist…"}
					</span>
				</button>
			)}

			{expanded && (
				<div
					className="border border-transparent rounded-[10px] overflow-hidden"
					style={{
						background:
							"oklch(from var(--t-surface) calc(l - 0.012) calc(c + 0.002) calc(h + 2))",
						// @ts-expect-error -- corner-shape not yet in CSS typings
						cornerShape: "squircle",
					}}
				>
					<div
						className="border-b border-transparent px-2.5 py-1.5 flex items-center gap-1"
						style={{
							borderBottomColor:
								"oklch(from var(--t-surface) calc(l - 0.06) c h / 0.3)",
						}}
					>
						<input
							ref={inputRef}
							type="text"
							role="combobox"
							aria-expanded="true"
							aria-controls={listboxId}
							aria-autocomplete="list"
							aria-activedescendant={
								artists.length > 0 ? optionId(activeIndex) : undefined
							}
							value={query}
							onChange={(e) => {
								setQuery(e.target.value);
								setActiveIndex(0);
							}}
							onKeyDown={handleSearchKeyDown}
							placeholder="Search artists…"
							aria-label="Search your liked artists"
							className="flex-1 min-w-0 border-0 bg-transparent text-xs theme-text placeholder:theme-text-muted focus-visible:outline-none"
						/>
						<button
							type="button"
							onClick={closeSearch}
							aria-label="Close artist search"
							className="shrink-0 inline-flex items-center justify-center theme-text-muted cursor-pointer opacity-50 transition-opacity duration-150 hover:opacity-100"
							style={{ background: "transparent", border: "none", padding: 2 }}
						>
							<XIcon size={10} weight="bold" aria-hidden />
						</button>
					</div>

					{/* APG combobox pattern: focus stays on the input above; this
					    listbox is navigated via aria-activedescendant, so its
					    options are role="option" rather than separate Tab stops. */}
					<div
						id={listboxId}
						role="listbox"
						aria-label="Liked artists"
						aria-multiselectable="true"
						className="overflow-y-auto"
						style={{ maxHeight: 180 }}
					>
						{isSearching && artists.length === 0 && !isSearchFetching ? (
							<div
								role="presentation"
								className="px-2.5 py-2 text-xs theme-text-muted"
							>
								No liked artists match &ldquo;
								{debouncedQuery || query.trim()}&rdquo;
							</div>
						) : (
							artists.map((artist, index) => {
								const selection = selectionByName.get(artist.name);
								const isEnabled = selection?.enabled ?? false;
								return (
									<ArtistOptionRow
										key={artist.name}
										id={optionId(index)}
										name={artist.name}
										count={selection ? selection.songCount : artist.count}
										isSelected={!!selection}
										isEnabled={isEnabled}
										isActive={index === activeIndex}
										onClick={() =>
											selection
												? onToggleArtist(artist.name)
												: onAddArtist(artist.name)
										}
										onPointerMove={() => setActiveIndex(index)}
									/>
								);
							})
						)}
					</div>
				</div>
			)}

			{selections.length > 0 && (
				<div className="flex flex-wrap items-center gap-2 pt-0.5">
					{inlineChips.map((s) => (
						<ArtistChip
							key={s.name}
							name={s.name}
							count={s.songCount}
							enabled={s.enabled}
							onToggle={() => onToggleArtist(s.name)}
							onRemove={() => onRemoveArtist(s.name)}
						/>
					))}
					{overflowCount > 0 && (
						<button
							type="button"
							onClick={() => setOverflowOpen(true)}
							className="cursor-pointer rounded-full border border-transparent px-2 py-0.5 text-xs whitespace-nowrap theme-text-muted"
							style={{
								background:
									"oklch(from var(--t-surface) calc(l - 0.025) calc(c + 0.003) calc(h + 3))",
							}}
						>
							+{overflowCount} more
						</button>
					)}
				</div>
			)}

			{isResolutionError && (
				// role="status" so the failure (and its later resolution) is
				// announced without stealing focus. A dedicated message rather than
				// leaving the chips' "…" to speak for itself — that state gave no
				// indication anything was wrong, let alone how to fix it.
				<p
					role="status"
					className="theme-text-muted flex items-center gap-2 pt-1 text-xs"
				>
					Couldn't load song counts for your selected artists.
					<button
						type="button"
						onClick={onRetryResolution}
						className="cursor-pointer rounded-full border border-transparent px-2 py-0.5 text-xs whitespace-nowrap"
						style={{
							background:
								"oklch(from var(--t-surface) calc(l - 0.025) calc(c + 0.003) calc(h + 3))",
						}}
					>
						Retry
					</button>
				</p>
			)}

			{overflowOpen && (
				<ArtistOverflowDialog
					selections={sortedSelections}
					onToggleArtist={onToggleArtist}
					onRemove={onRemoveArtist}
					onClose={() => setOverflowOpen(false)}
				/>
			)}
		</div>
	);
}

/**
 * One artist chip in the selection row. Body and ✕ are SIBLING buttons
 * (nesting would be invalid HTML): body toggles enabled/disabled, ✕ removes
 * outright. Disabled chips stay in the row — dimmed, not hidden — so a
 * paused artist remains reachable without re-searching for it.
 */
function ArtistChip({
	name,
	count,
	enabled,
	onToggle,
	onRemove,
}: {
	name: string;
	count: number | null;
	enabled: boolean;
	onToggle: () => void;
	onRemove: () => void;
}) {
	return (
		<span
			className="inline-flex items-center gap-1 rounded-[10px] py-1 pr-1.5 pl-2.5 text-[11px] whitespace-nowrap"
			style={
				enabled
					? {
							background: "var(--t-primary)",
							color: "var(--t-text-on-primary)",
							border: "1px solid transparent",
							// @ts-expect-error -- corner-shape not yet in CSS typings
							cornerShape: "squircle",
						}
					: {
							background:
								"oklch(from var(--t-surface) calc(l - 0.025) calc(c + 0.003) calc(h + 3))",
							color: "var(--t-text-muted)",
							border:
								"1px dashed oklch(from var(--t-surface) calc(l - 0.1) c h / 0.5)",
							opacity: 0.75,
							cornerShape: "squircle",
						}
			}
		>
			<button
				type="button"
				onClick={onToggle}
				aria-label={`${enabled ? "Disable" : "Enable"} ${name}`}
				className="inline-flex items-center gap-1 cursor-pointer"
			>
				<span className="max-w-[16ch] truncate">{name}</span>
				<span className="tabular-nums opacity-60">{count ?? "…"}</span>
			</button>
			<button
				type="button"
				onClick={onRemove}
				aria-label={`Remove ${name}`}
				className="inline-flex items-center opacity-70 cursor-pointer transition-opacity duration-150 hover:opacity-100"
				style={{ marginLeft: 2 }}
			>
				<XIcon size={10} weight="bold" aria-hidden />
			</button>
		</span>
	);
}

/**
 * One row in the search/browse list. role="option" (not a button) per the APG
 * combobox pattern: the parent's search input owns focus and keyboard
 * activation via aria-activedescendant, so this row is deliberately NOT a Tab
 * stop. Pointer users still click it directly; onPointerMove keeps hover in
 * sync with the keyboard's active index.
 */
function ArtistOptionRow({
	id,
	name,
	count,
	isSelected,
	isEnabled,
	isActive,
	onClick,
	onPointerMove,
}: {
	id: string;
	name: string;
	count: number | null;
	isSelected: boolean;
	isEnabled: boolean;
	isActive: boolean;
	onClick: () => void;
	onPointerMove: () => void;
}) {
	const label = !isSelected
		? `Add ${name}`
		: `${isEnabled ? "Disable" : "Enable"} ${name}`;

	return (
		<div
			id={id}
			role="option"
			aria-selected={isSelected}
			aria-label={label}
			tabIndex={-1}
			onClick={onClick}
			onPointerMove={onPointerMove}
			// Not a real Tab stop (see the doc comment above) — this only satisfies
			// the lint rule pairing onClick with a keyboard equivalent. Actual
			// keyboard activation is Enter on the search input above, which reads
			// this same onClick via the parent's activeIndex.
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onClick();
				}
			}}
			className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs cursor-pointer transition-[background-color] duration-100 theme-text"
			style={{
				background: isActive
					? "oklch(from var(--t-surface) calc(l - 0.04) calc(c + 0.005) calc(h + 5))"
					: isEnabled
						? "oklch(from var(--t-surface) calc(l - 0.03) calc(c + 0.003) calc(h + 3))"
						: "transparent",
			}}
		>
			<span className="truncate">{name}</span>
			<span className="flex items-center gap-2.5">
				{count !== null && (
					<span className="text-[10px] tabular-nums theme-text-muted">
						{count} songs
					</span>
				)}
				{isEnabled && (
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
}

// No dialog primitive exists in this codebase yet (every aria-modal dialog
// here — UnlockConfirmDialog, PaywallDialog, this one — hand-rolls its own
// focus restore without trapping Tab), so this is a local containment fix
// rather than a new shared abstraction.
const DIALOG_FOCUSABLE_SELECTOR =
	'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Full-set management for a large artist selection: search-within, per-artist
 * toggle + remove (same chip as the inline row), same active-then-inactive /
 * like-count sorting (selections arrive pre-sorted from the caller), and
 * searching collapses the grouping to a flat filter.
 */
function ArtistOverflowDialog({
	selections,
	onToggleArtist,
	onRemove,
	onClose,
}: {
	selections: ArtistSelectionVM[];
	onToggleArtist: (name: string) => void;
	onRemove: (name: string) => void;
	onClose: () => void;
}) {
	const [filter, setFilter] = useState("");
	const dialogRef = useRef<HTMLDivElement>(null);

	useShortcut({
		key: "escape",
		handler: onClose,
		description: "Close artist selection",
		scope: "modal",
		category: "actions",
	});

	useEffect(() => {
		const previouslyFocused = document.activeElement;
		dialogRef.current?.focus();
		return () => {
			if (
				previouslyFocused instanceof HTMLElement &&
				previouslyFocused.isConnected
			) {
				previouslyFocused.focus();
			}
		};
	}, []);

	// aria-modal="true" is a screen-reader hint only — it doesn't stop Tab from
	// walking into the obscured page behind the dialog. Cycle within the
	// dialog's own focusable elements instead (the backdrop's close button is
	// deliberately excluded: it's reachable by click, not by Tab).
	const handleTabTrap = (e: KeyboardEvent<HTMLDivElement>) => {
		if (e.key !== "Tab") return;
		const container = dialogRef.current;
		if (!container) return;
		const focusable = Array.from(
			container.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR),
		);
		if (focusable.length === 0) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		const active = document.activeElement;
		const activeIsInside = focusable.includes(active as HTMLElement);
		if (e.shiftKey) {
			// Initial focus sits on the dialog container itself (not in
			// `focusable`), so Shift+Tab from there must wrap explicitly too —
			// otherwise it walks backward past the dialog into the backdrop/page.
			if (!activeIsInside || active === first) {
				e.preventDefault();
				last.focus();
			}
		} else if (active === last) {
			e.preventDefault();
			first.focus();
		}
	};

	const handleRemove = (name: string) => {
		const container = dialogRef.current;
		const active = document.activeElement;
		const focusableBefore = container
			? Array.from(
					container.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR),
				)
			: [];
		const previousIndex = focusableBefore.indexOf(active as HTMLElement);

		onRemove(name);

		// Removing the focused chip detaches that element and sends focus to the
		// document body, where the dialog's keydown trap can no longer hear Tab.
		// Restore the same position in the new focus order after React commits.
		window.requestAnimationFrame(() => {
			const current = dialogRef.current;
			if (!current || current.contains(document.activeElement)) return;
			const focusableAfter = Array.from(
				current.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR),
			);
			const nextIndex =
				previousIndex >= 0
					? Math.min(previousIndex, focusableAfter.length - 1)
					: 0;
			(focusableAfter[nextIndex] ?? current).focus();
		});
	};

	const needle = filter.trim().toLowerCase();
	const visible =
		needle === ""
			? selections
			: selections.filter((s) => s.name.toLowerCase().includes(needle));

	return createPortal(
		<div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
			<button
				type="button"
				aria-label="Close dialog"
				className="absolute inset-0 cursor-default appearance-none border-0 bg-black/50 p-0 backdrop-blur-sm"
				onClick={onClose}
			/>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-label="Selected artists"
				tabIndex={-1}
				onKeyDown={handleTabTrap}
				className="relative flex max-h-[70vh] w-full max-w-md flex-col gap-4 border border-transparent p-6 outline-none"
				style={{
					background: "var(--t-surface)",
					fontFamily: fonts.body,
					// @ts-expect-error -- corner-shape not yet in CSS typings
					cornerShape: "squircle",
				}}
			>
				<div className="flex items-center justify-between gap-4">
					<span className="theme-text-muted text-[11px] tracking-[0.18em] uppercase">
						Artists · {selections.length}
					</span>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="theme-text-muted cursor-pointer p-1 transition-opacity duration-150 hover:opacity-70"
					>
						<XIcon size={16} weight="regular" aria-hidden />
					</button>
				</div>

				<input
					type="text"
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
					placeholder="Search within selection…"
					aria-label="Search within selected artists"
					className="theme-border-color theme-text w-full border-b bg-transparent px-1 py-1.5 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)]"
				/>

				<div className="flex flex-wrap content-start items-center gap-2 overflow-y-auto">
					{visible.map((selection) => (
						<ArtistChip
							key={selection.name}
							name={selection.name}
							count={selection.songCount}
							enabled={selection.enabled}
							onToggle={() => onToggleArtist(selection.name)}
							onRemove={() => handleRemove(selection.name)}
						/>
					))}
					{visible.length === 0 && (
						<p className="theme-text-muted py-1 text-xs">
							No selected artists match &ldquo;{filter.trim()}&rdquo;
						</p>
					)}
				</div>
			</div>
		</div>,
		document.body,
	);
}
