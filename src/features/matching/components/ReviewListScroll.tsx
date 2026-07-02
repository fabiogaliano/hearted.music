import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

// Matches the gap-5 between rows in the list below.
const ROW_GAP = 20;

// Used until the client measures real row heights (SSR / first paint) and as the
// fallback for the empty state, where there's no row to slice.
const FALLBACK_MAX_HEIGHT = "clamp(260px, 42dvh, 560px)";

// Target cap for the list height before it's snapped to a half-row. dvh-relative
// so taller screens show more rows; clamped so neither extreme gets silly.
function baseCapPx() {
	if (typeof window === "undefined") return 360;
	return Math.min(560, Math.max(260, window.innerHeight * 0.42));
}

// Shared scroll body for the two matching review columns — Best Matches (song
// mode) and Song Suggestions (playlist mode). They're the same two-column-stage
// list with different row contents, so both use this one container: a capped,
// internally scrolling column whose persistent themed scrollbar (see
// .review-list-scroll in styles.css) is the "more below" cue, with the review
// controls pinned below it. min-h-0 lets the flex child shrink so overflow-y
// triggers when the list exceeds the available space; pr-1 keeps the row dividers
// off the scrollbar gutter.
//
// The max-height is snapped so the last visible row is always sliced ~in half — a
// hard-cut peek that reads as "there's more" — instead of landing on a clean row
// boundary, which looks like the list simply ends. We measure a real row rather
// than hardcoding a pixel height so the slice survives font/row changes, and
// derive the row count from the viewport so tall screens still show more rows,
// just always ending on a half-row. When it overflows, a soft scrim
// (.review-list-fade) dissolves the sliced cover art into the page background so
// the cut doesn't end on a razor edge.
export function ReviewListScroll({
	children,
	footer,
}: {
	children: ReactNode;
	/**
	 * Rendered inside the scrolling container but outside the measured `listRef`
	 * div — e.g. the tail-paging sentinel. It must scroll with the rows so
	 * IntersectionObserver fires on approach, but staying outside `listRef`
	 * keeps it out of the half-row-peek measurement and the `rows.length < 2`
	 * fallback (a sentinel isn't a "row" for either purpose). Rendered after the
	 * fade so the fade's negative margin overlaps the last row, not the footer.
	 */
	footer?: ReactNode;
}) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const listRef = useRef<HTMLDivElement | null>(null);
	const [maxHeight, setMaxHeight] = useState<string>(FALLBACK_MAX_HEIGHT);
	const [overflowing, setOverflowing] = useState(false);

	useLayoutEffect(() => {
		const list = listRef.current;
		if (!list) return;

		const measure = () => {
			const rows = Array.from(list.children).filter(
				(c): c is HTMLElement => c instanceof HTMLElement,
			);
			const firstRow = rows[0];
			const rowH = firstRow?.getBoundingClientRect().height ?? 0;
			// Empty state or too few rows to make a half-row peek meaningful — let the
			// list size to its content under a plain cap.
			if (!firstRow || rows.length < 2 || rowH < 40) {
				setMaxHeight(FALLBACK_MAX_HEIGHT);
				setOverflowing(false);
				return;
			}
			// Cut through the vertical centre of the row's cover art so the last
			// visible row shows exactly half its artwork — an unmistakable "more below"
			// peek — rather than trailing off in the row's bottom padding (cutting at
			// half the *row* box still shows ~3/4 of the art). Falls back to a fraction
			// of the row height when a row has no <img> (placeholder art).
			const rowTop = firstRow.getBoundingClientRect().top;
			const artRect = firstRow.querySelector("img")?.getBoundingClientRect();
			const sliceOffset = artRect
				? artRect.top - rowTop + artRect.height / 2
				: rowH * 0.35;
			const pitch = rowH + ROW_GAP;
			// As many whole rows as fit the cap, then half of the next row's artwork.
			const fullRows = Math.max(1, Math.floor(baseCapPx() / pitch));
			const peek = Math.round(fullRows * pitch + sliceOffset);
			setMaxHeight(`${peek}px`);
			const contentH =
				rows.reduce((sum, r) => sum + r.getBoundingClientRect().height, 0) +
				(rows.length - 1) * ROW_GAP;
			setOverflowing(contentH > peek + 1);
		};

		measure();
		// Observe the list body for row add/remove (dismiss) and font-load reflow;
		// watch the window for dvh changes (a capped element won't resize with it).
		const observer =
			typeof ResizeObserver !== "undefined"
				? new ResizeObserver(measure)
				: null;
		observer?.observe(list);
		window.addEventListener("resize", measure);
		return () => {
			observer?.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, []);

	return (
		<div
			ref={scrollRef}
			className="review-list-scroll mt-6 min-h-0 flex-1 overflow-y-auto pr-1"
			style={{ maxHeight }}
		>
			<div ref={listRef} className="flex flex-col gap-5">
				{children}
			</div>
			{overflowing && <div className="review-list-fade" aria-hidden />}
			{footer}
		</div>
	);
}
