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
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import { scrollListElementIntoView } from "@/lib/keyboard/listScroll";
import type {
	ListNavigationOptions,
	ListNavigationResult,
} from "@/lib/keyboard/types";
import { useListCursor } from "@/lib/keyboard/useListCursor";
import { useShortcut } from "@/lib/keyboard/useShortcut";

const useIsomorphicLayoutEffect =
	typeof window !== "undefined" ? useLayoutEffect : useEffect;

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

	const moveFocus = useCallback(
		(step: number) => {
			const change = cursor.moveFocusedIndex(step, {
				source: "keyboard",
				mode: "keyboard",
			});
			if (!change) return;

			maybeLoadMore(change.index);
			queueScroll(change.sequence);
		},
		[cursor, maybeLoadMore, queueScroll],
	);

	const isColumnMajor = rows !== undefined;
	const verticalStep = direction === "grid" ? (isColumnMajor ? 1 : columns) : 1;
	const horizontalStep = isColumnMajor ? rows : 1;

	const handleRight = useCallback(
		() => moveFocus(horizontalStep),
		[horizontalStep, moveFocus],
	);
	const handleLeft = useCallback(
		() => moveFocus(-horizontalStep),
		[horizontalStep, moveFocus],
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
		if (cursor.focusedIndex < 0 || cursor.focusedIndex >= items.length) return;

		const item = items[cursor.focusedIndex];
		const element = cursor.getFocusedElement();
		onSelect?.(item, cursor.focusedIndex, element);
	}, [cursor, items, onSelect]);

	const verticalEnabled =
		enabled && (direction === "vertical" || direction === "grid");
	const horizontalEnabled =
		enabled && (direction === "horizontal" || direction === "grid");

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

	useShortcut({
		key: "space",
		handler: handleSelect,
		description: "Select item",
		scope,
		category: "actions",
		enabled: enabled && cursor.focusedIndex >= 0,
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
					pendingScrollsRef.current.set(change.sequence, scrollBlock);
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

				scrollListElementIntoView(element, scrollBlock);
			},
			[cursor, scrollBlock],
		);

	return {
		focusedIndex: cursor.focusedIndex,
		focusedItem: cursor.focusedItem,
		interactionMode: cursor.interactionMode,
		lastCursorChange: cursor.lastCursorChange,
		getFocusedElement: cursor.getFocusedElement,
		getElementAtIndex: cursor.getElementAtIndex,
		syncFocusedIndex,
		focusFocusedItem,
		getItemProps: cursor.getItemProps,
	};
}
