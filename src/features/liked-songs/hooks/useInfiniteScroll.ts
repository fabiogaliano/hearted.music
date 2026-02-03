/**
 * Hook: useInfiniteScroll
 *
 * Generic infinite scroll hook using IntersectionObserver.
 * Attach the returned sentinelRef to an element at the bottom of your list.
 * When that element enters the viewport, onLoadMore is called.
 */
import { useCallback, useEffect, useRef } from "react";

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
	sentinelRef: React.RefObject<HTMLDivElement | null>;
}

export function useInfiniteScroll({
	onLoadMore,
	hasMore,
	threshold = 100,
}: UseInfiniteScrollOptions): UseInfiniteScrollResult {
	const sentinelRef = useRef<HTMLDivElement>(null);

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
		if (!hasMore) return;

		const observer = new IntersectionObserver(handleIntersect, {
			rootMargin: `${threshold}px`,
		});

		const sentinel = sentinelRef.current;
		if (sentinel) {
			observer.observe(sentinel);
		}

		return () => observer.disconnect();
	}, [hasMore, threshold, handleIntersect]);

	return { sentinelRef };
}
