/**
 * Hook: useInfiniteScroll
 *
 * Generic infinite scroll hook using IntersectionObserver.
 * Attach the returned sentinelRef to an element at the bottom of your list.
 * When that element enters the viewport, onLoadMore is called.
 */
import type { RefCallback } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

interface UseInfiniteScrollOptions {
	/** Called when sentinel element becomes visible */
	onLoadMore: () => void;
	/** Whether there are more items to load */
	hasMore: boolean;
	/** Pixels before sentinel to trigger load (default: 100) */
	threshold?: number;
}

interface UseInfiniteScrollResult {
	/** Ref to attach to your sentinel element */
	sentinelRef: RefCallback<HTMLDivElement>;
}

export function useInfiniteScroll({
	onLoadMore,
	hasMore,
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

	useEffect(() => {
		if (!hasMore || sentinel === null) return;

		const observer = new IntersectionObserver(handleIntersect, {
			rootMargin: `${threshold}px`,
		});

		observer.observe(sentinel);

		return () => observer.disconnect();
	}, [hasMore, threshold, handleIntersect, sentinel]);

	return { sentinelRef };
}
