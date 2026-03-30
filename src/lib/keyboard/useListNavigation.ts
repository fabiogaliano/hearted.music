/**
 * useListNavigation - Reusable hook for keyboard-navigable lists
 *
 * Features:
 * - Vertical: j/k and up/down arrows
 * - Horizontal: h/l and left/right arrows
 * - Grid: all four directions
 * - Enter/Space to select
 * - Auto-scroll to keep focused item visible
 * - Roving tabindex pattern
 * - Ref management for each item
 * - Load more when nearing end
 *
 * Usage:
 * ```tsx
 * const { focusedIndex, getItemProps } = useListNavigation({
 *   items: songs,
 *   scope: 'liked-list',
 *   enabled: !isDetailOpen,
 *   onSelect: (song, index, element) => handleExpand(song, element),
 *   getId: (song) => song.track.id,
 *   direction: 'vertical', // or 'horizontal' or 'grid'
 * })
 *
 * {songs.map((song, i) => (
 *   <div {...getItemProps(song, i)}>
 *     <SongCard song={song} isFocused={focusedIndex === i} />
 *   </div>
 * ))}
 * ```
 */
import type { FocusEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
	ListNavigationOptions,
	ListNavigationResult,
} from "@/lib/keyboard/types";
import { useShortcut } from "@/lib/keyboard/useShortcut";

function prefersReducedMotion(): boolean {
	if (typeof window === "undefined") return false;
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Smooth scroll causes a visible "ghost trail" when scrollBlock is "center"
// because the browser animates the entire viewport to re-center the target.
function resolveScrollBehavior(
	scrollBlock: ScrollLogicalPosition,
): ScrollBehavior {
	if (prefersReducedMotion()) return "auto";
	if (scrollBlock === "center") return "auto";
	return "smooth";
}

export function useListNavigation<T>(
	options: ListNavigationOptions<T>,
): ListNavigationResult<T> {
	const {
		items,
		scope,
		enabled = true,
		onSelect,
		getId,
		onFocusChange,
		onLoadMore,
		hasMore = false,
		direction = "vertical",
		columns = 1,
		rows,
		scrollBlock = "nearest",
	} = options;

	const [focusedIndex, setFocusedIndex] = useState<number>(-1);
	const [isEngaged, setIsEngaged] = useState<boolean>(false);
	const [hasFocusWithin, setHasFocusWithin] = useState<boolean>(false);
	const itemRefs = useRef<Map<string | number, HTMLElement>>(new Map());
	const prevFocusedIndexRef = useRef<number>(-1);
	const isProgrammaticFocusRef = useRef<boolean>(false);

	const focusedItem =
		focusedIndex >= 0 && focusedIndex < items.length
			? items[focusedIndex]
			: null;

	const getFocusedElement = useCallback((): HTMLElement | null => {
		if (focusedIndex < 0 || focusedIndex >= items.length) return null;
		const item = items[focusedIndex];
		const id = getId(item);
		return itemRefs.current.get(id) || null;
	}, [focusedIndex, items, getId]);

	const getElementAtIndex = useCallback(
		(index: number): HTMLElement | null => {
			if (index < 0 || index >= items.length) return null;
			const item = items[index];
			const id = getId(item);
			return itemRefs.current.get(id) || null;
		},
		[items, getId],
	);

	const scrollElementIntoView = useCallback(
		(element: HTMLElement) => {
			element.scrollIntoView({
				behavior: resolveScrollBehavior(scrollBlock),
				block: scrollBlock,
				inline: "nearest",
			});
		},
		[scrollBlock],
	);

	const scrollIndexIntoView = useCallback(
		(index: number) => {
			const element = getElementAtIndex(index);
			if (!element) return;
			scrollElementIntoView(element);
		},
		[getElementAtIndex, scrollElementIntoView],
	);

	// Shared by both horizontal and vertical handlers
	const moveFocus = useCallback(
		(step: number) => {
			setIsEngaged(true);
			setFocusedIndex((prev) => {
				if (prev < 0) return 0;
				const next = Math.max(0, Math.min(items.length - 1, prev + step));
				if (next >= items.length - 2 && hasMore && onLoadMore) {
					onLoadMore();
				}
				return next;
			});
		},
		[items.length, hasMore, onLoadMore],
	);

	// Grid navigation supports two layouts:
	// - Row-major (default): down/up = ±columns, left/right = ±1
	// - Column-major (when `rows` is set): down/up = ±1, left/right = ±rows
	const isColumnMajor = rows !== undefined;
	const verticalStep = direction === "grid" ? (isColumnMajor ? 1 : columns) : 1;
	const horizontalStep = isColumnMajor ? rows : 1;

	const handleRight = useCallback(
		() => moveFocus(horizontalStep),
		[moveFocus, horizontalStep],
	);
	const handleLeft = useCallback(
		() => moveFocus(-horizontalStep),
		[moveFocus, horizontalStep],
	);
	const handleDown = useCallback(
		() => moveFocus(verticalStep),
		[moveFocus, verticalStep],
	);
	const handleUp = useCallback(
		() => moveFocus(-verticalStep),
		[moveFocus, verticalStep],
	);

	const handleSelect = useCallback(() => {
		if (focusedIndex >= 0 && focusedIndex < items.length) {
			const item = items[focusedIndex];
			const id = getId(item);
			const element = itemRefs.current.get(id) || null;
			onSelect?.(item, focusedIndex, element);
		}
	}, [focusedIndex, items, getId, onSelect]);

	const verticalEnabled =
		enabled && (direction === "vertical" || direction === "grid");

	useShortcut({
		key: "j",
		handler: handleDown,
		description: "Next item",
		scope,
		category: "navigation",
		enabled: verticalEnabled,
	});

	useShortcut({
		key: "down",
		handler: handleDown,
		description: "Next item",
		scope,
		category: "navigation",
		enabled: verticalEnabled,
	});

	useShortcut({
		key: "k",
		handler: handleUp,
		description: "Previous item",
		scope,
		category: "navigation",
		enabled: verticalEnabled,
	});

	useShortcut({
		key: "up",
		handler: handleUp,
		description: "Previous item",
		scope,
		category: "navigation",
		enabled: verticalEnabled,
	});

	const horizontalEnabled =
		enabled && (direction === "horizontal" || direction === "grid");

	useShortcut({
		key: "l",
		handler: handleRight,
		description: "Next item",
		scope,
		category: "navigation",
		enabled: horizontalEnabled,
	});

	useShortcut({
		key: "right",
		handler: handleRight,
		description: "Next item",
		scope,
		category: "navigation",
		enabled: horizontalEnabled,
	});

	useShortcut({
		key: "h",
		handler: handleLeft,
		description: "Previous item",
		scope,
		category: "navigation",
		enabled: horizontalEnabled,
	});

	useShortcut({
		key: "left",
		handler: handleLeft,
		description: "Previous item",
		scope,
		category: "navigation",
		enabled: horizontalEnabled,
	});

	// Selection with Space (standard for toggle/select)
	// Enter is NOT bound here - it should be handled by parent component for submit/continue
	useShortcut({
		key: "space",
		handler: handleSelect,
		description: "Select item",
		scope,
		category: "actions",
		enabled: enabled && focusedIndex >= 0,
	});

	const focusIndex = useCallback(
		(index: number, opts?: { engage?: boolean; scroll?: boolean }) => {
			if (!enabled) return;
			if (index < 0 || index >= items.length) return;

			if (opts?.engage) setIsEngaged(true);

			const element = getElementAtIndex(index);
			if (!element) return;

			isProgrammaticFocusRef.current = true;
			element.focus({ preventScroll: true });
			isProgrammaticFocusRef.current = false;
			if (opts?.scroll === false) return;
			scrollElementIntoView(element);
		},
		[enabled, items.length, getElementAtIndex, scrollElementIntoView],
	);

	const focusFocusedItem = useCallback(
		(opts?: { engage?: boolean; scroll?: boolean }) => {
			focusIndex(focusedIndex, opts);
		},
		[focusIndex, focusedIndex],
	);

	const syncFocusedIndex = useCallback(
		(
			index: number,
			opts?: { engage?: boolean; focus?: boolean; scroll?: boolean },
		) => {
			if (index < 0 || index >= items.length) return;

			const { engage = false, focus = false, scroll = true } = opts ?? {};

			if (engage) setIsEngaged(true);
			setFocusedIndex(index);

			if (!scroll) return;

			if (focus && enabled) {
				focusIndex(index, { engage, scroll: true });
				return;
			}

			scrollIndexIntoView(index);
		},
		[items.length, enabled, focusIndex, scrollIndexIntoView],
	);

	useEffect(() => {
		const indexChanged = prevFocusedIndexRef.current !== focusedIndex;
		prevFocusedIndexRef.current = focusedIndex;

		if (!indexChanged) return;

		// Active mode: focus + scroll when user navigates with j/k/arrows
		if (enabled && isEngaged) {
			focusIndex(focusedIndex);
		}
	}, [focusedIndex, isEngaged, enabled, focusIndex]);

	useEffect(() => {
		onFocusChange?.(focusedIndex, focusedItem);
	}, [focusedIndex, focusedItem, onFocusChange]);

	// Reset focus when items change significantly
	useEffect(() => {
		if (focusedIndex >= items.length) {
			setFocusedIndex(items.length > 0 ? items.length - 1 : -1);
		}
	}, [items.length, focusedIndex]);

	// Roving tabindex pattern
	const getItemProps = useCallback(
		(item: T, index: number) => {
			const id = getId(item);
			const isFocused = focusedIndex === index;
			const isVisuallyFocused = isEngaged && hasFocusWithin && isFocused;
			return {
				ref: (el: HTMLElement | null) => {
					if (el) {
						itemRefs.current.set(id, el);
					} else {
						itemRefs.current.delete(id);
					}
				},
				"data-focused": isVisuallyFocused,
				"data-nav-engaged": isEngaged,
				onPointerDown: () => {
					setIsEngaged(false);
					setFocusedIndex(index);
				},
				onFocus: () => {
					if (!hasFocusWithin && !isProgrammaticFocusRef.current) {
						setIsEngaged(false);
					}
					setHasFocusWithin(true);
					setFocusedIndex(index);
				},
				onBlur: (event: FocusEvent<HTMLElement>) => {
					const nextFocused = event.relatedTarget as HTMLElement | null;
					if (!nextFocused) {
						setHasFocusWithin(false);
						return;
					}

					// If focus moved to another item in this list, keep state.
					for (const el of itemRefs.current.values()) {
						if (el === nextFocused) return;
					}
					setHasFocusWithin(false);
				},
				// Roving tabindex: only focused item (or first if none focused) gets tabIndex 0
				tabIndex: isFocused || (focusedIndex === -1 && index === 0) ? 0 : -1,
			};
		},
		[getId, focusedIndex, isEngaged, hasFocusWithin],
	);

	return {
		focusedIndex,
		setFocusedIndex,
		syncFocusedIndex,
		getFocusedElement,
		focusFocusedItem,
		getItemProps,
		focusedItem,
	};
}
