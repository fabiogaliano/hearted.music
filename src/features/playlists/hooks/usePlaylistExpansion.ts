import { useNavigate } from "@tanstack/react-router";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { flushSync } from "react-dom";

const useIsomorphicLayoutEffect =
	typeof window !== "undefined" ? useLayoutEffect : useEffect;

const supportsViewTransitions =
	typeof document !== "undefined" && "startViewTransition" in document;

function withViewTransition(callback: () => void): Promise<void> {
	if (supportsViewTransitions) {
		const transition = (
			document as unknown as {
				startViewTransition: (cb: () => void) => { finished: Promise<void> };
			}
		).startViewTransition(() => {
			flushSync(callback);
		});
		return transition.finished;
	}
	callback();
	return Promise.resolve();
}

interface ExpandedRect {
	top: number;
	left: number;
	width: number;
	height: number;
}

const ZERO_RECT: ExpandedRect = { top: 0, left: 0, width: 0, height: 0 };

function rectsEqual(a: ExpandedRect, b: ExpandedRect): boolean {
	return (
		a.top === b.top &&
		a.left === b.left &&
		a.width === b.width &&
		a.height === b.height
	);
}

interface UsePlaylistExpansionOptions {
	selectedPlaylistId?: string | null;
	getRouteRefForPlaylistId: (playlistId: string) => string | null;
}

export function usePlaylistExpansion({
	selectedPlaylistId: routePlaylistId,
	getRouteRefForPlaylistId,
}: UsePlaylistExpansionOptions) {
	const navigate = useNavigate();

	const [localSelectedId, setLocalSelectedId] = useState<string | null>(
		routePlaylistId ?? null,
	);
	const [isExpanded, setIsExpanded] = useState(routePlaylistId != null);
	const [startRect, setStartRect] = useState<ExpandedRect | null>(null);
	const [closingToPlaylistId, setClosingToPlaylistId] = useState<string | null>(
		null,
	);
	const [expandedRect, setExpandedRect] = useState<ExpandedRect>(ZERO_RECT);
	const expansionColumnRef = useRef<HTMLDivElement>(null);
	const isClosingRef = useRef(false);
	type PendingRouteSelection =
		| { type: "playlist"; id: string }
		| { type: "closed" };
	const pendingRouteSelectionRef = useRef<PendingRouteSelection | null>(null);

	// Reads layout (getBoundingClientRect + window.innerHeight). Callers must
	// avoid invoking this during render — it forces a synchronous reflow.
	const measureExpandedRect = useCallback((): ExpandedRect => {
		if (!expansionColumnRef.current) return ZERO_RECT;
		const colRect = expansionColumnRef.current.getBoundingClientRect();
		const top = Math.max(0, colRect.top);
		return {
			top,
			left: colRect.left,
			width: colRect.width,
			height: window.innerHeight - top,
		};
	}, []);

	const updateUrl = useCallback(
		(id: string | null) => {
			if (id === null) {
				void navigate({
					to: "/playlists",
					replace: false,
					resetScroll: false,
				});
				return;
			}

			const playlistRef = getRouteRefForPlaylistId(id);
			if (playlistRef === null) {
				return;
			}

			void navigate({
				to: "/playlists/$playlistRef",
				params: { playlistRef },
				replace: false,
				resetScroll: false,
			});
		},
		[getRouteRefForPlaylistId, navigate],
	);

	const handleExpand = useCallback(
		(id: string, element: HTMLElement) => {
			const itemRect = element.getBoundingClientRect();
			setStartRect({
				top: itemRect.top,
				left: itemRect.left,
				width: itemRect.width,
				height: itemRect.height,
			});
			// Measure the destination rect here (during the click handler, before
			// any state update commits) so the panel's first render at
			// isExpanded=false already has the correct fixed-position geometry.
			// The rAF×2 below then flips isExpanded to true, giving the browser
			// a paint frame at the from-state before transitioning to to-state.
			const nextRect = measureExpandedRect();
			setExpandedRect((prev) => (rectsEqual(prev, nextRect) ? prev : nextRect));

			setLocalSelectedId(id);
			pendingRouteSelectionRef.current = { type: "playlist", id };
			updateUrl(id);

			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					setIsExpanded(true);
				});
			});
		},
		[measureExpandedRect, updateUrl],
	);

	const handleClose = useCallback(async () => {
		const targetId = localSelectedId;

		isClosingRef.current = true;
		pendingRouteSelectionRef.current = { type: "closed" };
		updateUrl(null);

		if (supportsViewTransitions) {
			await withViewTransition(() => {
				setClosingToPlaylistId(targetId);
				setIsExpanded(false);
			});
		} else {
			setClosingToPlaylistId(targetId);
			setIsExpanded(false);
			await new Promise((resolve) => setTimeout(resolve, 220));
		}

		setLocalSelectedId(null);
		setStartRect(null);
		setClosingToPlaylistId(null);
		isClosingRef.current = false;
	}, [localSelectedId, updateUrl]);

	// Sync local state from route changes we did NOT initiate (back/forward,
	// deep links, sidebar navigation). For changes we initiated via
	// handleExpand/handleClose, pendingRouteSelectionRef marks them as
	// already-owned so we don't pre-empt the rAF-driven transition timing.
	useEffect(() => {
		const routeId = routePlaylistId ?? null;
		const pendingRouteSelection = pendingRouteSelectionRef.current;

		if (pendingRouteSelection !== null) {
			const matchesPendingSelection =
				pendingRouteSelection.type === "closed"
					? routeId === null
					: routeId === pendingRouteSelection.id;

			if (matchesPendingSelection) {
				pendingRouteSelectionRef.current = null;
			}
			return;
		}

		if (routeId === null) {
			if (isClosingRef.current || localSelectedId === null) {
				return;
			}

			setIsExpanded(false);
			setLocalSelectedId(null);
			setStartRect(null);
			setClosingToPlaylistId(null);
			return;
		}

		if (routeId === localSelectedId) {
			if (!isExpanded) {
				setIsExpanded(true);
			}
			return;
		}

		setStartRect(null);
		setClosingToPlaylistId(null);
		setLocalSelectedId(routeId);
		setIsExpanded(true);
	}, [isExpanded, localSelectedId, routePlaylistId]);

	// Measure overlay geometry after layout so paint happens with the correct
	// rect. Runs on mount when isExpanded is already true (deep links / route
	// remount on first open) and whenever isExpanded flips on.
	useIsomorphicLayoutEffect(() => {
		if (!isExpanded) return;
		const next = measureExpandedRect();
		setExpandedRect((prev) => (rectsEqual(prev, next) ? prev : next));
	}, [isExpanded, measureExpandedRect]);

	// Keep the overlay correctly sized when the viewport changes while open.
	useEffect(() => {
		if (!isExpanded) return;
		const handleResize = () => {
			const next = measureExpandedRect();
			setExpandedRect((prev) => (rectsEqual(prev, next) ? prev : next));
		};
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, [isExpanded, measureExpandedRect]);

	const selectedPlaylistId = localSelectedId;

	return {
		selectedPlaylistId,
		isExpanded,
		startRect,
		expandedRect,
		expansionColumnRef,
		handleExpand,
		handleClose,
		closingToPlaylistId,
	};
}
