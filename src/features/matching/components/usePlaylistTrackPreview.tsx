import { useInfiniteQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
	type HTMLAttributes,
	type FocusEvent as ReactFocusEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { TrackList } from "@/features/playlists/components/TrackList";
import type { PlaylistTrackVM } from "@/features/playlists/components/types";
import { playlistTracksInfiniteQueryOptions } from "@/features/playlists/queries";
import { fonts } from "@/lib/theme/fonts";

interface UsePlaylistTrackPreviewArgs {
	playlistId: string;
	songCount: number | null;
	/** Off in the canned demo/walkthrough, where playlist ids aren't real rows. */
	canLoadTracks: boolean;
}

type TriggerProps = Pick<
	HTMLAttributes<HTMLElement>,
	| "onPointerEnter"
	| "onPointerMove"
	| "onPointerLeave"
	| "onFocus"
	| "onBlur"
	| "tabIndex"
	| "aria-describedby"
	| "style"
>;

interface PlaylistTrackPreview {
	/** Spread onto the cover+name region so both — and the gap between them — open
	 *  the preview as one bridge. Empty when previews are disabled. */
	triggerProps: TriggerProps;
	/** The floating preview, portaled to <body>. Render it once near the trigger. */
	preview: ReactNode;
}

// Hover-intent timing mirrors InfoTip: a deliberate open delay so a cursor
// sweeping across the row doesn't flash it, and a short close grace so crossing
// the small gap from the name to the floating card doesn't dismiss it.
const OPEN_DELAY = 320;
const CLOSE_DELAY = 160;

const CARD_GAP = 12;
const CARD_WIDTH = 360;
const VIEWPORT_MARGIN = 8;

interface CardPosition {
	left: number;
	top: number;
	width: number;
	maxHeight: number;
	/** Placed to the left of the cursor → scale out from its right edge. */
	placeLeft: boolean;
}

interface Point {
	x: number;
	y: number;
}

interface Viewport {
	width: number;
	height: number;
}

/** Pure placement math (no DOM globals) so it stays node-testable: anchor the
 *  card at the cursor, opening down-right of it, flipping left when there isn't
 *  room, and clamping both axes into the viewport. */
export function computePosition(
	point: Point,
	viewport: Viewport,
): CardPosition {
	const { width: vw, height: vh } = viewport;
	const width = Math.min(CARD_WIDTH, vw - VIEWPORT_MARGIN * 2);
	const maxHeight = Math.min(460, Math.round(vh * 0.7));

	const placeLeft = point.x + CARD_GAP + width > vw - VIEWPORT_MARGIN;
	const rawLeft = placeLeft ? point.x - CARD_GAP - width : point.x + CARD_GAP;
	const left = Math.max(
		VIEWPORT_MARGIN,
		Math.min(rawLeft, vw - VIEWPORT_MARGIN - width),
	);
	const top = Math.max(
		VIEWPORT_MARGIN,
		Math.min(point.y + CARD_GAP, vh - VIEWPORT_MARGIN - maxHeight),
	);
	return { left, top, width, maxHeight, placeLeft };
}

/**
 * Drives the playlist track preview for a match row. Hovering the cover or the
 * name (one bridged region via `triggerProps`) reveals a floating card at the
 * cursor showing that playlist's track list — and nothing else. The card is
 * portaled to <body> so it escapes the matching panel's overflow-hidden height
 * animator, and stays open while the cursor is inside it so the list can scroll.
 *
 * Tracks load lazily — the infinite query is only enabled once the card has
 * opened, and React Query keeps the result cached so re-hovering is instant.
 * Hover is gated to fine-pointer devices; on touch the row's cover + reason
 * already identify the playlist.
 */
export function usePlaylistTrackPreview({
	playlistId,
	songCount,
	canLoadTracks,
}: UsePlaylistTrackPreviewArgs): PlaylistTrackPreview {
	const prefersReducedMotion = useReducedMotion();
	const [open, setOpen] = useState(false);
	const [everOpened, setEverOpened] = useState(false);
	const [position, setPosition] = useState<CardPosition | null>(null);
	const pointer = useRef<Point>({ x: 0, y: 0 });
	const openTimer = useRef<number | null>(null);
	const closeTimer = useRef<number | null>(null);
	const id = useId();

	const clearTimers = useCallback(() => {
		if (openTimer.current) window.clearTimeout(openTimer.current);
		if (closeTimer.current) window.clearTimeout(closeTimer.current);
		openTimer.current = null;
		closeTimer.current = null;
	}, []);

	const scheduleOpen = useCallback(() => {
		clearTimers();
		openTimer.current = window.setTimeout(() => {
			// Anchor at wherever the cursor settled when the intent delay elapsed.
			setPosition(
				computePosition(pointer.current, {
					width: window.innerWidth,
					height: window.innerHeight,
				}),
			);
			setOpen(true);
			setEverOpened(true);
		}, OPEN_DELAY);
	}, [clearTimers]);

	const scheduleClose = useCallback(() => {
		clearTimers();
		closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY);
	}, [clearTimers]);

	const handleTriggerEnter = useCallback(
		(event: ReactPointerEvent) => {
			// Only fine-pointer devices get the hover preview — touch "hover" fires on
			// tap and would trap the card open over the row the user meant to add.
			if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches)
				return;
			pointer.current = { x: event.clientX, y: event.clientY };
			scheduleOpen();
		},
		[scheduleOpen],
	);

	// Record the cursor as it moves over the trigger, so the card anchors wherever
	// the pointer settled when the intent delay elapses. Position is computed once
	// (in scheduleOpen) and then frozen, so the card stays put while the user moves
	// into it to scroll — tracking past that point is harmless.
	const handleTriggerMove = useCallback((event: ReactPointerEvent) => {
		pointer.current = { x: event.clientX, y: event.clientY };
	}, []);

	// Keyboard/AT entry point. Focus is deliberate, so there's no hover-intent
	// delay and no fine-pointer gate; we anchor to the trigger's own box (no
	// cursor to follow) and reuse the same flip/clamp placement math.
	const handleTriggerFocus = useCallback(
		(event: ReactFocusEvent<HTMLElement>) => {
			clearTimers();
			const rect = event.currentTarget.getBoundingClientRect();
			pointer.current = { x: rect.left, y: rect.bottom };
			setPosition(
				computePosition(pointer.current, {
					width: window.innerWidth,
					height: window.innerHeight,
				}),
			);
			setOpen(true);
			setEverOpened(true);
		},
		[clearTimers],
	);

	useEffect(() => clearTimers, [clearTimers]);

	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				clearTimers();
				setOpen(false);
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, clearTimers]);

	// Lazy: until the card has opened once, pass null so the query key resolves to
	// tracks("") and stays disabled — no fetch for rows nobody previews. On first
	// open the key switches to the real playlist id and the fetch (or cache hit)
	// fires; React Query keeps it cached so re-hovering is instant.
	const enabledId = canLoadTracks && everOpened ? playlistId : null;
	const tracksQuery = useInfiniteQuery(
		playlistTracksInfiniteQueryOptions(enabledId),
	);
	const tracks = useMemo<PlaylistTrackVM[]>(
		() =>
			(tracksQuery.data?.pages.flatMap((page) => page.tracks) ?? []).map(
				(t) => ({
					position: t.position,
					name: t.name,
					artists: t.artists,
					albumName: t.albumName,
					imageUrl: t.imageUrl,
				}),
			),
		[tracksQuery.data],
	);
	const loadMoreTracks = useCallback(() => {
		if (tracksQuery.hasNextPage && !tracksQuery.isFetchingNextPage)
			void tracksQuery.fetchNextPage();
	}, [tracksQuery]);

	const total = songCount ?? tracks.length;

	const triggerProps: TriggerProps = canLoadTracks
		? {
				onPointerEnter: handleTriggerEnter,
				onPointerMove: handleTriggerMove,
				onPointerLeave: scheduleClose,
				onFocus: handleTriggerFocus,
				onBlur: scheduleClose,
				// Focusable so keyboard/AT users can reach the same preview the cursor
				// gets. Points at the card while it's open so the track list is read as
				// this region's description (APG tooltip pattern).
				tabIndex: 0,
				"aria-describedby": open ? id : undefined,
				// Override the text I-beam the name <p> would otherwise show: the name
				// is a hover surface, not editable text. `default` (not `pointer`) —
				// there's nothing to click here; Add owns the action.
				style: { cursor: "default" },
			}
		: {};

	const preview =
		canLoadTracks && typeof document !== "undefined"
			? createPortal(
					<AnimatePresence>
						{open && position && (
							<motion.div
								key={id}
								id={id}
								role="tooltip"
								onPointerEnter={clearTimers}
								onPointerLeave={scheduleClose}
								initial={
									prefersReducedMotion
										? { opacity: 0 }
										: { opacity: 0, scale: 0.97 }
								}
								animate={{
									opacity: 1,
									scale: 1,
									transition: { duration: 0.18, ease: [0.165, 0.84, 0.44, 1] },
								}}
								exit={
									prefersReducedMotion
										? { opacity: 0, transition: { duration: 0.1 } }
										: {
												opacity: 0,
												scale: 0.98,
												// ease-out (same family as enter), ~20% faster — an
												// exiting element still wants the responsive fast start.
												transition: {
													duration: 0.14,
													ease: [0.165, 0.84, 0.44, 1],
												},
											}
								}
								className="theme-surface-bg theme-border-color fixed z-[60] flex flex-col overflow-y-auto overscroll-contain border px-4 py-3"
								style={{
									left: position.left,
									top: position.top,
									width: position.width,
									maxHeight: position.maxHeight,
									transformOrigin: `${position.placeLeft ? "right" : "left"} top`,
									boxShadow:
										"0 18px 48px -24px color-mix(in srgb, var(--t-text) 42%, transparent)",
									willChange: "transform",
								}}
							>
								{tracksQuery.isLoading ? (
									<p
										className="theme-text-muted text-xs"
										style={{ fontFamily: fonts.body }}
									>
										Loading tracks…
									</p>
								) : tracks.length > 0 ? (
									<TrackList
										tracks={tracks}
										songCount={total}
										hasMore={tracksQuery.hasNextPage}
										isLoadingMore={tracksQuery.isFetchingNextPage}
										onLoadMore={loadMoreTracks}
										hideAlbum
										hideEmptyState
									/>
								) : (
									<p
										className="theme-text-muted text-xs"
										style={{ fontFamily: fonts.body }}
									>
										No tracks to preview yet.
									</p>
								)}
							</motion.div>
						)}
					</AnimatePresence>,
					document.body,
				)
			: null;

	return { triggerProps, preview };
}
