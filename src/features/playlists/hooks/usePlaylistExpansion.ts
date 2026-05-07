import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

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
	const expansionColumnRef = useRef<HTMLDivElement>(null);
	const isClosingRef = useRef(false);
	type PendingRouteSelection =
		| { type: "playlist"; id: string }
		| { type: "closed" };
	const pendingRouteSelectionRef = useRef<PendingRouteSelection | null>(null);

	const getExpandedRect = useCallback((): ExpandedRect => {
		if (!expansionColumnRef.current)
			return { top: 0, left: 0, width: 0, height: 0 };
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

			setLocalSelectedId(id);
			pendingRouteSelectionRef.current = { type: "playlist", id };
			updateUrl(id);

			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					setIsExpanded(true);
				});
			});
		},
		[updateUrl],
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

	// Sync local state from route changes (back/forward, deep links)
	useEffect(() => {
		const routeId = routePlaylistId ?? null;
		const pendingRouteSelection = pendingRouteSelectionRef.current;

		if (pendingRouteSelection !== null) {
			const matchesPendingSelection =
				pendingRouteSelection.type === "closed"
					? routeId === null
					: routeId === pendingRouteSelection.id;

			if (!matchesPendingSelection) {
				return;
			}

			pendingRouteSelectionRef.current = null;
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

	const selectedPlaylistId = localSelectedId;

	return {
		selectedPlaylistId,
		isExpanded,
		startRect,
		expandedRect: getExpandedRect(),
		expansionColumnRef,
		handleExpand,
		handleClose,
		closingToPlaylistId,
	};
}
