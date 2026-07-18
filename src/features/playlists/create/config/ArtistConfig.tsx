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
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { fonts } from "@/lib/theme/fonts";
import { likedArtistSearchQueryOptions } from "../queries";
import type { ArtistSelectionVM } from "../useCreatePlaylistDraft";

// Chips visible inline before the overflow dialog takes over. Sized for a
// ~300px sidebar column: enough to see a real selection, small enough that a
// large set doesn't push the other config panels off screen.
const INLINE_CHIP_CAP = 8;
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
	const [overflowOpen, setOverflowOpen] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
	const isSearching = query.trim().length > 0;

	// The empty-query aggregate doubles as the like-count source for sorting;
	// it's the same cache entry the browse mode would use.
	const { data: browseData } = useQuery(likedArtistSearchQueryOptions(""));
	const likeCounts = useMemo(
		() => new Map((browseData?.artists ?? []).map((a) => [a.name, a.count])),
		[browseData],
	);

	const { data: searchData, isFetching: isSearchFetching } = useQuery({
		...likedArtistSearchQueryOptions(debouncedQuery),
		enabled: debouncedQuery.length > 0,
	});

	const selectionByName = useMemo(
		() => new Map(selections.map((s) => [s.name, s])),
		[selections],
	);

	const sorted = useMemo(
		() => sortSelections(selections, likeCounts),
		[selections, likeCounts],
	);

	// Focus the input when the seed's "+" affordance lands the user here.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only focus
	useEffect(() => {
		if (autoFocusSearch) inputRef.current?.focus();
	}, []);

	const searchResults = (searchData?.artists ?? []).slice(
		0,
		SEARCH_RESULT_LIMIT,
	);

	const inlineChips = sorted.slice(0, INLINE_CHIP_CAP);
	const overflowCount = sorted.length - inlineChips.length;

	return (
		<div className="flex flex-col gap-2" style={{ fontFamily: fonts.body }}>
			<span className="theme-text-muted text-[10px] tracking-[0.16em] uppercase">
				Artists
			</span>

			<input
				ref={inputRef}
				type="text"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				placeholder="Find a liked artist…"
				aria-label="Search your liked artists"
				className="theme-border-color theme-text w-full border-b bg-transparent px-1 py-1.5 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)]"
			/>

			{isSearching ? (
				// Flat search results — grouping disappears; toggling an unselected
				// result adds+enables it, an already-added one shows its live state.
				<div className="flex flex-wrap items-center gap-2 pt-1">
					{searchResults.map((result) => {
						const selection = selectionByName.get(result.name);
						return (
							<ArtistChip
								key={result.name}
								name={result.name}
								count={selection ? selection.songCount : result.count}
								state={
									selection
										? selection.enabled
											? "enabled"
											: "disabled"
										: "unselected"
								}
								onBody={() =>
									selection
										? onToggleArtist(result.name)
										: onAddArtist(result.name)
								}
								onRemove={
									selection ? () => onRemoveArtist(result.name) : undefined
								}
							/>
						);
					})}
					{searchResults.length === 0 && !isSearchFetching && (
						<p className="theme-text-muted py-1 text-xs">
							No liked artists match “{debouncedQuery || query.trim()}”
						</p>
					)}
				</div>
			) : (
				selections.length > 0 && (
					<div className="flex flex-wrap items-center gap-2 pt-1">
						{inlineChips.map((selection) => (
							<ArtistChip
								key={selection.name}
								name={selection.name}
								count={selection.songCount}
								state={selection.enabled ? "enabled" : "disabled"}
								onBody={() => onToggleArtist(selection.name)}
								onRemove={() => onRemoveArtist(selection.name)}
							/>
						))}
						{overflowCount > 0 && (
							<button
								type="button"
								onClick={() => setOverflowOpen(true)}
								className="theme-border-color theme-text-muted hover-border-brighten cursor-pointer rounded-full border px-3 py-1.5 text-xs whitespace-nowrap"
							>
								+{overflowCount} more
							</button>
						)}
					</div>
				)
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
						className="theme-border-color hover-border-brighten cursor-pointer rounded-full border px-2 py-0.5 text-xs whitespace-nowrap"
					>
						Retry
					</button>
				</p>
			)}

			{overflowOpen && (
				<ArtistOverflowDialog
					selections={selections}
					likeCounts={likeCounts}
					onToggleArtist={onToggleArtist}
					onRemove={onRemoveArtist}
					onClose={() => setOverflowOpen(false)}
				/>
			)}
		</div>
	);
}

/**
 * One artist chip. The body and the ✕ are SIBLING buttons (nesting would be
 * invalid HTML): body click toggles enabled/disabled, ✕ removes. Enabled wears
 * the primary tint (same material as genre chips), disabled dims, unselected
 * (search results not yet added) reads as a quiet outline "add me" pill.
 */
function ArtistChip({
	name,
	count,
	state,
	onBody,
	onRemove,
}: {
	name: string;
	/** Filter-aware song count (selected) or like count (search result); null = resolving. */
	count: number | null;
	state: "enabled" | "disabled" | "unselected";
	onBody: () => void;
	onRemove?: () => void;
}) {
	const chipStyle =
		state === "enabled"
			? {
					color: "var(--t-primary)",
					border:
						"1px solid color-mix(in srgb, var(--t-primary) 32%, transparent)",
					background: "color-mix(in srgb, var(--t-primary) 9%, transparent)",
				}
			: state === "disabled"
				? {
						color: "var(--t-text-muted)",
						border: "1px solid var(--t-border)",
						background: "transparent",
						opacity: 0.55,
					}
				: {
						color: "var(--t-text-muted)",
						border: "1px dashed var(--t-border)",
						background: "transparent",
					};

	return (
		<span
			className="inline-flex items-center gap-1.5 rounded-full py-1.5 pr-2.5 pl-3 text-xs whitespace-nowrap"
			style={chipStyle}
		>
			<button
				type="button"
				onClick={onBody}
				aria-pressed={state === "enabled"}
				aria-label={
					state === "unselected"
						? `Add ${name}`
						: `${state === "enabled" ? "Disable" : "Enable"} ${name}`
				}
				className="inline-flex cursor-pointer items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)]"
			>
				<span className="max-w-[16ch] truncate">{name}</span>
				<span className="tabular-nums opacity-60">{count ?? "…"}</span>
			</button>
			{onRemove && (
				<button
					type="button"
					onClick={onRemove}
					aria-label={`Remove ${name}`}
					className="relative inline-flex cursor-pointer items-center opacity-60 transition-opacity duration-150 after:absolute after:-inset-2 after:content-[''] hover:opacity-100"
				>
					<XIcon size={11} weight="regular" aria-hidden />
				</button>
			)}
		</span>
	);
}

/**
 * Full-set management for a large artist selection: search-within, per-artist
 * toggle + remove (same Undo path as the panel), same active-then-inactive /
 * like-count sorting, and searching collapses the grouping to a flat filter.
 */
function ArtistOverflowDialog({
	selections,
	likeCounts,
	onToggleArtist,
	onRemove,
	onClose,
}: {
	selections: ArtistSelectionVM[];
	likeCounts: Map<string, number>;
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

	const needle = filter.trim().toLowerCase();
	const visible =
		needle === ""
			? sortSelections(selections, likeCounts)
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
				className="theme-surface-bg theme-border-color relative flex max-h-[70vh] w-full max-w-md flex-col gap-4 border p-6 outline-none"
				style={{ fontFamily: fonts.body }}
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
							state={selection.enabled ? "enabled" : "disabled"}
							onBody={() => onToggleArtist(selection.name)}
							onRemove={() => onRemove(selection.name)}
						/>
					))}
					{visible.length === 0 && (
						<p className="theme-text-muted py-1 text-xs">
							No selected artists match “{filter.trim()}”
						</p>
					)}
				</div>
			</div>
		</div>,
		document.body,
	);
}
