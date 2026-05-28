/**
 * useListNavigation - Reusable hook for keyboard-navigable lists
 *
 * Layers:
 * - useListCursor owns cursor state, refs, roving tabindex, and interaction mode
 * - useListNavigation adds directional shortcuts, selection, and default auto-scroll
 *
 * Consumers that need source-specific scroll behavior can use `autoScroll: false`
 * and react to `lastCursorChange` themselves.
 */

import { useCallback, useRef } from "react";
import { useIsomorphicLayoutEffect } from "@/lib/hooks/useIsomorphicLayoutEffect";
import { scrollListElementIntoView } from "@/lib/keyboard/listScroll";
import type {
	ListNavigationOptions,
	ListNavigationResult,
} from "@/lib/keyboard/types";
import { useListCursor } from "@/lib/keyboard/useListCursor";
import { useShortcut } from "@/lib/keyboard/useShortcut";

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
		onCursorChange,
		onLoadMore,
		hasMore = false,
		direction = "vertical",
		columns = 1,
		rows,
		scrollBlock = "nearest",
		autoScroll = true,
		onOverflowUp,
		onOverflowDown,
		onLateralLeft,
		onLateralRight,
	} = options;

	const cursor = useListCursor<T>({
		items,
		enabled,
		getId,
		onFocusChange,
		onCursorChange,
	});
	const pendingScrollsRef = useRef<Map<number, typeof scrollBlock>>(new Map());

	const queueScroll = useCallback(
		(sequence: number, block = scrollBlock) => {
			if (!autoScroll) return;
			pendingScrollsRef.current.set(sequence, block);
		},
		[autoScroll, scrollBlock],
	);

	const maybeLoadMore = useCallback(
		(index: number) => {
			if (index >= items.length - 2 && hasMore && onLoadMore) {
				onLoadMore();
			}
		},
		[hasMore, items.length, onLoadMore],
	);

	// Returns true when the cursor moved; false when it clamped at an edge
	// (or the list is empty / no item was focused). Callers fire overflow
	// callbacks based on the false branch.
	const moveFocus = useCallback(
		(step: number): boolean => {
			const change = cursor.moveFocusedIndex(step, {
				source: "keyboard",
				mode: "keyboard",
			});
			if (!change) return false;

			maybeLoadMore(change.index);
			queueScroll(change.sequence);
			return true;
		},
		[cursor, maybeLoadMore, queueScroll],
	);

	// True when DOM focus is on a descendant of a row but not the row itself —
	// i.e. a nested control like an "Add" / "Remove" button. Lateral shortcuts
	// must not hijack interaction with these controls.
	const isFocusOnNestedRowControl = useCallback((): boolean => {
		if (typeof document === "undefined") return false;
		const active = document.activeElement;
		if (!(active instanceof HTMLElement)) return false;
		for (let i = 0; i < items.length; i += 1) {
			const row = cursor.getElementAtIndex(i);
			if (!row) continue;
			if (row === active) return false;
			if (row.contains(active)) return true;
		}
		return false;
	}, [cursor, items.length]);

	const shouldHandleListShortcut = useCallback(
		() => !isFocusOnNestedRowControl(),
		[isFocusOnNestedRowControl],
	);

	const isColumnMajor = rows !== undefined;
	const verticalStep = direction === "grid" ? (isColumnMajor ? 1 : columns) : 1;
	const horizontalStep = isColumnMajor ? rows : 1;

	const handleDown = useCallback(() => {
		// Read from the cursor's ref, not the React state, because the focus event
		// that put us at the bottom edge may not have flushed state yet.
		const previousIndex = cursor.getCurrentIndex();
		const moved = moveFocus(verticalStep);
		if (moved) return;
		if (
			items.length > 0 &&
			previousIndex === items.length - 1 &&
			onOverflowDown
		) {
			onOverflowDown();
		}
	}, [cursor, items.length, moveFocus, onOverflowDown, verticalStep]);

	const handleUp = useCallback(() => {
		const previousIndex = cursor.getCurrentIndex();
		const moved = moveFocus(-verticalStep);
		if (moved) return;
		if (items.length > 0 && previousIndex === 0 && onOverflowUp) {
			onOverflowUp();
		}
	}, [cursor, items.length, moveFocus, onOverflowUp, verticalStep]);

	const handleRight = useCallback(() => {
		if (onLateralRight) {
			if (isFocusOnNestedRowControl()) return;
			onLateralRight();
			return;
		}
		moveFocus(horizontalStep);
	}, [horizontalStep, isFocusOnNestedRowControl, moveFocus, onLateralRight]);

	const handleLeft = useCallback(() => {
		if (onLateralLeft) {
			if (isFocusOnNestedRowControl()) return;
			onLateralLeft();
			return;
		}
		moveFocus(-horizontalStep);
	}, [horizontalStep, isFocusOnNestedRowControl, moveFocus, onLateralLeft]);

	const handleSelect = useCallback(() => {
		if (isFocusOnNestedRowControl()) return;
		if (cursor.focusedIndex < 0 || cursor.focusedIndex >= items.length) return;

		const item = items[cursor.focusedIndex];
		const element = cursor.getFocusedElement();
		onSelect?.(item, cursor.focusedIndex, element);
	}, [cursor, isFocusOnNestedRowControl, items, onSelect]);

	const verticalEnabled =
		enabled && (direction === "vertical" || direction === "grid");
	const horizontalEnabled =
		enabled && (direction === "horizontal" || direction === "grid");
	// Register left/right whenever lateral callbacks are wired, even when the
	// direction doesn't include horizontal movement — the callback always wins.
	const leftShortcutEnabled =
		horizontalEnabled || (enabled && Boolean(onLateralLeft));
	const rightShortcutEnabled =
		horizontalEnabled || (enabled && Boolean(onLateralRight));

	useShortcut({
		key: "j",
		handler: handleDown,
		description: "Next item",
		scope,
		category: "navigation",
		enabled: verticalEnabled,
		shouldHandle: shouldHandleListShortcut,
	});

	useShortcut({
		key: "down",
		handler: handleDown,
		description: "Next item",
		scope,
		category: "navigation",
		enabled: verticalEnabled,
		shouldHandle: shouldHandleListShortcut,
	});

	useShortcut({
		key: "k",
		handler: handleUp,
		description: "Previous item",
		scope,
		category: "navigation",
		enabled: verticalEnabled,
		shouldHandle: shouldHandleListShortcut,
	});

	useShortcut({
		key: "up",
		handler: handleUp,
		description: "Previous item",
		scope,
		category: "navigation",
		enabled: verticalEnabled,
		shouldHandle: shouldHandleListShortcut,
	});

	useShortcut({
		key: "l",
		handler: handleRight,
		description: "Next item",
		scope,
		category: "navigation",
		enabled: rightShortcutEnabled,
		shouldHandle: shouldHandleListShortcut,
	});

	useShortcut({
		key: "right",
		handler: handleRight,
		description: "Next item",
		scope,
		category: "navigation",
		enabled: rightShortcutEnabled,
		shouldHandle: shouldHandleListShortcut,
	});

	useShortcut({
		key: "h",
		handler: handleLeft,
		description: "Previous item",
		scope,
		category: "navigation",
		enabled: leftShortcutEnabled,
		shouldHandle: shouldHandleListShortcut,
	});

	useShortcut({
		key: "left",
		handler: handleLeft,
		description: "Previous item",
		scope,
		category: "navigation",
		enabled: leftShortcutEnabled,
		shouldHandle: shouldHandleListShortcut,
	});

	useShortcut({
		key: "space",
		handler: handleSelect,
		description: "Select item",
		scope,
		category: "actions",
		enabled: enabled && cursor.focusedIndex >= 0,
		shouldHandle: shouldHandleListShortcut,
	});

	useIsomorphicLayoutEffect(() => {
		const change = cursor.lastCursorChange;
		if (!change) return;

		const block = pendingScrollsRef.current.get(change.sequence);
		if (!block) return;
		pendingScrollsRef.current.delete(change.sequence);

		const element = cursor.getElementAtIndex(change.index);
		if (!element) return;

		scrollListElementIntoView(element, block);
	}, [cursor.getElementAtIndex, cursor.lastCursorChange]);

	const syncFocusedIndex: ListNavigationResult<T>["syncFocusedIndex"] =
		useCallback(
			(index, syncOptions) => {
				const change = cursor.syncFocusedIndex(index, {
					focus: syncOptions?.focus,
					mode: syncOptions?.mode,
					source: syncOptions?.source ?? "programmatic",
				});
				if (!change) return null;

				if (syncOptions?.scroll ?? autoScroll) {
					pendingScrollsRef.current.set(
						change.sequence,
						syncOptions?.scrollBlock ?? scrollBlock,
					);
				}

				return change;
			},
			[autoScroll, cursor, scrollBlock],
		);

	const focusFocusedItem: ListNavigationResult<T>["focusFocusedItem"] =
		useCallback(
			(focusOptions) => {
				cursor.focusFocusedItem({ mode: focusOptions?.mode });
				if (focusOptions?.scroll === false) return;

				const element = cursor.getFocusedElement();
				if (!element) return;

				scrollListElementIntoView(
					element,
					focusOptions?.scrollBlock ?? scrollBlock,
				);
			},
			[cursor, scrollBlock],
		);

	return {
		focusedIndex: cursor.focusedIndex,
		focusedItem: cursor.focusedItem,
		interactionMode: cursor.interactionMode,
		lastCursorChange: cursor.lastCursorChange,
		hasFocusWithin: cursor.hasFocusWithin,
		getFocusedElement: cursor.getFocusedElement,
		getElementAtIndex: cursor.getElementAtIndex,
		syncFocusedIndex,
		focusFocusedItem,
		focusIndex: cursor.focusIndex,
		getItemProps: cursor.getItemProps,
	};
}
