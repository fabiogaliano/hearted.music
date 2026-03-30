import { useCallback, useRef, useState } from "react";
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

export function usePlaylistExpansion() {
	const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(
		null,
	);
	const [isExpanded, setIsExpanded] = useState(false);
	const [startRect, setStartRect] = useState<{
		top: number;
		left: number;
		width: number;
		height: number;
	} | null>(null);
	const [closingToPlaylistId, setClosingToPlaylistId] = useState<string | null>(
		null,
	);
	const rightColumnRef = useRef<HTMLDivElement>(null);

	const getExpandedRect = useCallback((): ExpandedRect => {
		if (!rightColumnRef.current)
			return { top: 0, left: 0, width: 0, height: 0 };
		const colRect = rightColumnRef.current.getBoundingClientRect();
		const top = Math.max(0, colRect.top);
		return {
			top,
			left: colRect.left,
			width: colRect.width,
			height: window.innerHeight - top,
		};
	}, []);

	const handleExpand = useCallback((id: string, element: HTMLElement) => {
		const itemRect = element.getBoundingClientRect();
		setStartRect({
			top: itemRect.top,
			left: itemRect.left,
			width: itemRect.width,
			height: itemRect.height,
		});

		setSelectedPlaylistId(id);
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				setIsExpanded(true);
			});
		});
	}, []);

	const handleClose = useCallback(async () => {
		const targetId = selectedPlaylistId;

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

		setSelectedPlaylistId(null);
		setStartRect(null);
		setClosingToPlaylistId(null);
	}, [selectedPlaylistId]);

	return {
		selectedPlaylistId,
		isExpanded,
		startRect,
		expandedRect: getExpandedRect(),
		rightColumnRef,
		handleExpand,
		handleClose,
		closingToPlaylistId,
	};
}
