/**
 * Hook: useInfiniteScroll
 *
 * Generic infinite scroll hook using IntersectionObserver.
 * Attach the returned sentinelRef to an element at the bottom of your list.
 * When that element comes within `threshold` px of the visible area, onLoadMore
 * is called.
 */
import type { RefCallback } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

interface UseInfiniteScrollOptions {
	/** Called when sentinel element becomes visible */
	onLoadMore: () => void;
	/** Whether there are more items to load */
	hasMore: boolean;
	/** Rows loaded so far. A change re-checks the sentinel, so one still inside
	 *  the margin after a page lands keeps loading rather than waiting for a
	 *  scroll that won't change its intersection. A failed load changes nothing,
	 *  so it waits for the user to scroll again instead of retrying in a loop. */
	itemCount?: number;
	/** Pixels before the sentinel to trigger load (default: 100). Pixels, not a
	 *  percentage: IntersectionObserver resolves % margins against the root's
	 *  width. */
	threshold?: number;
}

interface UseInfiniteScrollResult {
	/** Ref to attach to your sentinel element */
	sentinelRef: RefCallback<HTMLDivElement>;
}

// rootMargin only grows the root's box. With the viewport as root, an inner
// scroller (the playlist panel) still clips the sentinel at its own edge, so
// the margin would never apply there; observing against the scroller does.
function nearestScrollContainer(element: Element): Element | null {
	for (let node = element.parentElement; node; node = node.parentElement) {
		const { overflowY } = getComputedStyle(node);
		if (overflowY === "auto" || overflowY === "scroll") return node;
	}
	return null;
}

export function useInfiniteScroll({
	onLoadMore,
	hasMore,
	itemCount = 0,
	threshold = 100,
}: UseInfiniteScrollOptions): UseInfiniteScrollResult {
	const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
	const sentinelRef = useCallback<RefCallback<HTMLDivElement>>((node) => {
		setSentinel(node);
	}, []);

	// Stabilize onLoadMore to prevent effect re-runs
	const onLoadMoreRef = useRef(onLoadMore);
	onLoadMoreRef.current = onLoadMore;

	const handleIntersect = useCallback(
		(entries: IntersectionObserverEntry[]) => {
			if (entries[0]?.isIntersecting) {
				onLoadMoreRef.current();
			}
		},
		[],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: itemCount is a re-check trigger, not a value read in the body — a fresh observer reports the sentinel's current intersection.
	useEffect(() => {
		if (!hasMore || sentinel === null) return;

		const observer = new IntersectionObserver(handleIntersect, {
			root: nearestScrollContainer(sentinel),
			rootMargin: `${threshold}px 0px`,
		});

		observer.observe(sentinel);

		return () => observer.disconnect();
	}, [hasMore, itemCount, threshold, handleIntersect, sentinel]);

	return { sentinelRef };
}
