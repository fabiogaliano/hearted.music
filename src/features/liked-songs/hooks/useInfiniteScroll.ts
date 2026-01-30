/**
 * Hook: useInfiniteScroll
 *
 * Generic infinite scroll hook using IntersectionObserver.
 * Attach the returned sentinelRef to an element at the bottom of your list.
 * When that element enters the viewport, onLoadMore is called.
 */
import { useCallback, useEffect, useRef } from "react";

interface UseInfiniteScrollOptions {
	onLoadMore: () => void;
	hasMore: boolean;
	threshold?: number;
}

interface UseInfiniteScrollResult {
	sentinelRef: React.RefObject<HTMLDivElement | null>;
}

export function useInfiniteScroll({
	onLoadMore,
	hasMore,
	threshold = 100,
}: UseInfiniteScrollOptions): UseInfiniteScrollResult {
	const sentinelRef = useRef<HTMLDivElement>(null);

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
