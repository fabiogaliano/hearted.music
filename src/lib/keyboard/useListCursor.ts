import type { FocusEvent } from "react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import type {
	ListCursorChange,
	ListCursorMoveOptions,
	ListCursorOptions,
	ListCursorResult,
	ListCursorSyncOptions,
	ListInteractionMode,
	ListNavigationSource,
} from "@/lib/keyboard/types";

const useIsomorphicLayoutEffect =
	typeof window !== "undefined" ? useLayoutEffect : useEffect;

function resolveInteractionMode(
	source: ListNavigationSource | undefined,
): ListInteractionMode | null {
	if (source === "keyboard") return "keyboard";
	if (source === "pointer") return "pointer";
	return null;
}

export function useListCursor<T>(
	options: ListCursorOptions<T>,
): ListCursorResult<T> {
	const {
		items,
		enabled = true,
		getId,
		onFocusChange,
		onCursorChange,
	} = options;

	const [focusedIndex, setFocusedIndexState] = useState<number>(-1);
	const [interactionMode, setInteractionMode] =
		useState<ListInteractionMode>("idle");
	const [hasFocusWithin, setHasFocusWithin] = useState<boolean>(false);
	const [lastCursorChange, setLastCursorChange] =
		useState<ListCursorChange | null>(null);
	const itemRefs = useRef<Map<string | number, HTMLElement>>(new Map());
	const focusedIndexRef = useRef<number>(-1);
	const prevFocusedIndexRef = useRef<number>(-1);
	const cursorChangeSequenceRef = useRef<number>(0);
	const isProgrammaticFocusRef = useRef<boolean>(false);
	const pendingFocusSourceRef = useRef<ListNavigationSource | null>(null);

	const setFocusedIndex = useCallback((index: number) => {
		focusedIndexRef.current = index;
		setFocusedIndexState(index);
	}, []);

	const focusedItem =
		focusedIndex >= 0 && focusedIndex < items.length
			? items[focusedIndex]
			: null;

	const getElementAtIndex = useCallback(
		(index: number): HTMLElement | null => {
			if (index < 0 || index >= items.length) return null;
			const item = items[index];
			const id = getId(item);
			return itemRefs.current.get(id) ?? null;
		},
		[items, getId],
	);

	const getFocusedElement = useCallback((): HTMLElement | null => {
		return getElementAtIndex(focusedIndex);
	}, [focusedIndex, getElementAtIndex]);

	const recordCursorChange = useCallback(
		(index: number, source: ListNavigationSource): ListCursorChange => {
			const change = {
				index,
				source,
				sequence: cursorChangeSequenceRef.current + 1,
			};
			cursorChangeSequenceRef.current = change.sequence;
			setLastCursorChange(change);
			return change;
		},
		[],
	);

	const applyInteractionMode = useCallback(
		(
			mode: ListInteractionMode | undefined,
			source: ListNavigationSource | undefined,
		) => {
			if (mode !== undefined) {
				setInteractionMode(mode);
				return;
			}

			const resolvedMode = resolveInteractionMode(source);
			if (resolvedMode !== null) {
				setInteractionMode(resolvedMode);
			}
		},
		[],
	);

	const focusIndex = useCallback(
		(index: number, focusOptions?: { mode?: ListInteractionMode }) => {
			if (!enabled) return;
			if (index < 0 || index >= items.length) return;

			if (focusOptions?.mode !== undefined) {
				setInteractionMode(focusOptions.mode);
			}

			const element = getElementAtIndex(index);
			if (!element) return;

			isProgrammaticFocusRef.current = true;
			element.focus({ preventScroll: true });
			isProgrammaticFocusRef.current = false;
		},
		[enabled, items.length, getElementAtIndex],
	);

	const focusFocusedItem = useCallback(
		(options?: { mode?: ListInteractionMode }) => {
			focusIndex(focusedIndexRef.current, options);
		},
		[focusIndex],
	);

	const syncFocusedIndex = useCallback(
		(index: number, syncOptions?: ListCursorSyncOptions) => {
			if (index < 0 || index >= items.length) return null;

			applyInteractionMode(syncOptions?.mode, syncOptions?.source);

			const previousIndex = focusedIndexRef.current;
			if (previousIndex !== index) {
				setFocusedIndex(index);
			}

			if (syncOptions?.focus) {
				focusIndex(index, { mode: syncOptions.mode });
			}

			if (previousIndex === index) {
				return null;
			}

			return recordCursorChange(index, syncOptions?.source ?? "programmatic");
		},
		[
			applyInteractionMode,
			focusIndex,
			items.length,
			recordCursorChange,
			setFocusedIndex,
		],
	);

	const moveFocusedIndex = useCallback(
		(step: number, moveOptions?: ListCursorMoveOptions) => {
			if (!enabled || items.length === 0) return null;

			applyInteractionMode(moveOptions?.mode, moveOptions?.source);

			const previousIndex = focusedIndexRef.current;
			const nextIndex =
				previousIndex < 0
					? 0
					: Math.max(0, Math.min(items.length - 1, previousIndex + step));

			if (previousIndex === nextIndex) {
				return null;
			}

			setFocusedIndex(nextIndex);
			return recordCursorChange(nextIndex, moveOptions?.source ?? "keyboard");
		},
		[
			applyInteractionMode,
			enabled,
			items.length,
			recordCursorChange,
			setFocusedIndex,
		],
	);

	useIsomorphicLayoutEffect(() => {
		const indexChanged = prevFocusedIndexRef.current !== focusedIndex;
		prevFocusedIndexRef.current = focusedIndex;

		if (!indexChanged) return;
		if (!enabled || interactionMode !== "keyboard") return;

		focusIndex(focusedIndex);
	}, [enabled, focusIndex, focusedIndex, interactionMode]);

	useEffect(() => {
		onFocusChange?.(focusedIndex, focusedItem);
	}, [focusedIndex, focusedItem, onFocusChange]);

	useEffect(() => {
		if (!lastCursorChange) return;
		const item =
			lastCursorChange.index >= 0 && lastCursorChange.index < items.length
				? items[lastCursorChange.index]
				: null;
		onCursorChange?.(lastCursorChange, item);
	}, [items, lastCursorChange, onCursorChange]);

	useEffect(() => {
		if (focusedIndex < items.length) return;

		const nextIndex = items.length > 0 ? items.length - 1 : -1;
		setFocusedIndex(nextIndex);
	}, [focusedIndex, items.length, setFocusedIndex]);

	const getItemProps = useCallback(
		(item: T, index: number) => {
			const id = getId(item);
			const isFocused = focusedIndex === index;
			const isVisuallyFocused =
				interactionMode === "keyboard" && hasFocusWithin && isFocused;

			return {
				ref: (el: HTMLElement | null) => {
					if (el) {
						itemRefs.current.set(id, el);
					} else {
						itemRefs.current.delete(id);
					}
				},
				"data-focused": isVisuallyFocused,
				"data-nav-engaged": interactionMode === "keyboard",
				onPointerDown: () => {
					pendingFocusSourceRef.current = "pointer";
					syncFocusedIndex(index, {
						source: "pointer",
						mode: "pointer",
						focus: false,
					});
				},
				onFocus: () => {
					const focusSource = pendingFocusSourceRef.current;
					pendingFocusSourceRef.current = null;

					if (
						!hasFocusWithin &&
						!isProgrammaticFocusRef.current &&
						focusSource !== "pointer"
					) {
						setInteractionMode("idle");
					}

					setHasFocusWithin(true);
					setFocusedIndex(index);
				},
				onBlur: (event: FocusEvent<HTMLElement>) => {
					const nextFocusedTarget = event.relatedTarget;
					const nextFocused =
						nextFocusedTarget instanceof HTMLElement ? nextFocusedTarget : null;
					if (!nextFocused) {
						setHasFocusWithin(false);
						return;
					}

					for (const el of itemRefs.current.values()) {
						if (el === nextFocused) return;
					}
					setHasFocusWithin(false);
				},
				tabIndex: isFocused || (focusedIndex === -1 && index === 0) ? 0 : -1,
			};
		},
		[
			focusedIndex,
			getId,
			hasFocusWithin,
			interactionMode,
			setFocusedIndex,
			syncFocusedIndex,
		],
	);

	return {
		focusedIndex,
		focusedItem,
		interactionMode,
		lastCursorChange,
		getFocusedElement,
		getElementAtIndex,
		moveFocusedIndex,
		syncFocusedIndex,
		focusIndex,
		focusFocusedItem,
		getItemProps,
	};
}
