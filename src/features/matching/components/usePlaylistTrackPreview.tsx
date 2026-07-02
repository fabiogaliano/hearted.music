import { useInfiniteQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
	type HTMLAttributes,
	type FocusEvent as ReactFocusEvent,
	type MouseEvent as ReactMouseEvent,
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
	/** Optional card header: the playlist name shown above the track list. */
	name?: string;
	/** Optional card header: the playlist's full "what it's for". The match row
	 *  clamps this to two lines, so the card is where the whole text is read. */
	reason?: string;
	/**
	 * How the preview is opened.
	 * - "hover" (song mode): a bridged cover+name region opens it on hover/focus;
	 *   the card is a `role="tooltip"` described by that region.
	 * - "disclosure" (playlist mode): the region still opens it on hover, but a
	 *   dedicated button handle (the "N songs" count) also toggles it on
	 *   click/tap/keyboard, so touch and AT users get a first-class trigger. The
	 *   card is then a `role="dialog"`.
	 */
	interaction?: "hover" | "disclosure";
	/** aria-label for the disclosure dialog, where there's no in-card header. */
	label?: string;
	/**
	 * Load the first track page immediately instead of on first open. Used in
	 * playlist mode: the single review subject's tracks are almost certainly
	 * wanted, so eager-loading seeds the handle's cover fan and makes the preview
	 * open instantly. Song mode leaves this off — its many candidate rows stay
	 * lazy so we don't fetch tracks nobody previews.
	 */
	eager?: boolean;
}

type TriggerProps = Pick<
	HTMLAttributes<HTMLElement>,
	| "onPointerEnter"
	| "onPointerLeave"
	| "onFocus"
	| "onBlur"
	| "tabIndex"
	| "aria-describedby"
	| "style"
>;

// Pointer-only subset for the region when a separate handle owns click/keyboard.
type HoverProps = Pick<
	HTMLAttributes<HTMLElement>,
	"onPointerEnter" | "onPointerLeave" | "style"
>;

interface HandleProps {
	type: "button";
	onClick: (event: ReactMouseEvent<HTMLElement>) => void;
	"aria-haspopup": "dialog";
	"aria-expanded": boolean;
	"aria-controls"?: string;
}

/** A cover for the handle's fan. `reused` marks art that likely already appears
 *  in the playlist's mosaic cover, so the UI sinks it to the back of the fan
 *  rather than showing it full and up front. */
export interface PlaylistPreviewCover {
	url: string;
	reused: boolean;
}

interface PlaylistTrackPreview {
	/** Full bundle for the hover model (song mode): spread onto the cover+name
	 *  region so both — and the gap between them — open the preview as one bridge. */
	triggerProps: TriggerProps;
	/** Pointer-only bundle for the disclosure model (playlist mode): the region
	 *  opens on hover, but keyboard/click belong to `handleProps`. */
	hoverProps: HoverProps;
	/** Button props for the disclosure handle (playlist mode's "N songs" count). */
	handleProps: HandleProps;
	/** The floating preview, portaled to <body>. Render it once near the trigger. */
	preview: ReactNode;
	/** A few track covers for the handle's fan, ordered back-to-front (reused
	 *  covers first so they sink behind the fresh ones). Empty until the track
	 *  query has data (immediately, when `eager`). */
	previewCovers: PlaylistPreviewCover[];
	/** Whether the preview is currently open (drives the handle's caret/aria). */
	isOpen: boolean;
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
	/** Placed to the left of the anchor → scale out from its right edge. */
	placeLeft: boolean;
}

/** The trigger's viewport box — the subset of DOMRect the math needs. */
interface AnchorRect {
	top: number;
	left: number;
	right: number;
}

interface Viewport {
	width: number;
	height: number;
}

/** Pure placement math (no DOM globals) so it stays node-testable. Anchors the
 *  card to the *trigger element* (not the cursor), placing it to the anchor's
 *  right and flipping to its left when there isn't room, top-aligned to the
 *  anchor and clamped into the viewport. Element-anchoring is what keeps the card
 *  in the same place every open — no "lands wherever the cursor stopped" jitter —
 *  and never covers the trigger it describes. */
export function computePosition(
	anchor: AnchorRect,
	viewport: Viewport,
): CardPosition {
	const { width: vw, height: vh } = viewport;
	const width = Math.min(CARD_WIDTH, vw - VIEWPORT_MARGIN * 2);
	const maxHeight = Math.min(460, Math.round(vh * 0.7));

	const placeLeft = anchor.right + CARD_GAP + width > vw - VIEWPORT_MARGIN;
	const rawLeft = placeLeft
		? anchor.left - CARD_GAP - width
		: anchor.right + CARD_GAP;
	const left = Math.max(
		VIEWPORT_MARGIN,
		Math.min(rawLeft, vw - VIEWPORT_MARGIN - width),
	);
	const top = Math.max(
		VIEWPORT_MARGIN,
		Math.min(anchor.top, vh - VIEWPORT_MARGIN - maxHeight),
	);
	return { left, top, width, maxHeight, placeLeft };
}

/**
 * Drives the playlist track preview for a match row / review item. The preview
 * is a floating card, anchored to its trigger element, showing that playlist's
 * track list. It's portaled to <body> so it escapes the matching panel's
 * overflow-hidden height animator, and stays open while the cursor is inside it
 * so the list can scroll.
 *
 * Two interaction models share the machinery (see `interaction`): song mode's
 * hover tooltip on a bridged cover+name region, and playlist mode's disclosure
 * where a button handle also toggles the card on click/tap/keyboard.
 *
 * Tracks load lazily by default — the infinite query is only enabled once the
 * card has opened — unless `eager`, which fetches the first page up front.
 * React Query keeps the result cached so re-opening is instant. Hover is gated
 * to fine-pointer devices; touch and keyboard reach the same card via the handle.
 */
export function usePlaylistTrackPreview({
	playlistId,
	songCount,
	canLoadTracks,
	name,
	reason,
	interaction = "hover",
	label,
	eager = false,
}: UsePlaylistTrackPreviewArgs): PlaylistTrackPreview {
	const prefersReducedMotion = useReducedMotion();
	const [open, setOpen] = useState(false);
	const [everOpened, setEverOpened] = useState(false);
	const [position, setPosition] = useState<CardPosition | null>(null);
	// Rows stagger in on the first reveal only; on later re-opens the list appears
	// at once, so a repeated hover-sweep doesn't replay the whole ripple.
	const [animateRows, setAnimateRows] = useState(true);
	const staggeredRef = useRef(false);
	// The element the card anchors to — set to whatever opened it (the region on
	// hover/focus, the handle on click). Read on open and on scroll/resize.
	const anchorEl = useRef<HTMLElement | null>(null);
	// Sticky = opened by an explicit click; it ignores hover-out and closes only on
	// Escape, click-outside, or a second click on the handle.
	const sticky = useRef(false);
	const previewRef = useRef<HTMLDivElement | null>(null);
	const openTimer = useRef<number | null>(null);
	const closeTimer = useRef<number | null>(null);
	const id = useId();

	const clearTimers = useCallback(() => {
		if (openTimer.current) window.clearTimeout(openTimer.current);
		if (closeTimer.current) window.clearTimeout(closeTimer.current);
		openTimer.current = null;
		closeTimer.current = null;
	}, []);

	const reposition = useCallback(() => {
		const el = anchorEl.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		setPosition(
			computePosition(
				{ top: rect.top, left: rect.left, right: rect.right },
				{ width: window.innerWidth, height: window.innerHeight },
			),
		);
	}, []);

	const openNow = useCallback(() => {
		reposition();
		setOpen(true);
		setEverOpened(true);
		setAnimateRows(!staggeredRef.current);
		staggeredRef.current = true;
	}, [reposition]);

	const close = useCallback(() => {
		setOpen(false);
		sticky.current = false;
	}, []);

	const scheduleOpen = useCallback(() => {
		clearTimers();
		openTimer.current = window.setTimeout(openNow, OPEN_DELAY);
	}, [clearTimers, openNow]);

	const scheduleClose = useCallback(() => {
		// A sticky (click-opened) card stays until dismissed explicitly.
		if (sticky.current) return;
		clearTimers();
		closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY);
	}, [clearTimers]);

	const handleTriggerEnter = useCallback(
		(event: ReactPointerEvent) => {
			// Only fine-pointer devices get the hover preview — touch "hover" fires on
			// tap and would trap the card open over the row the user meant to add.
			if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches)
				return;
			anchorEl.current = event.currentTarget as HTMLElement;
			scheduleOpen();
		},
		[scheduleOpen],
	);

	// Keyboard/AT entry point for the hover model (song mode). Focus is deliberate,
	// so there's no hover-intent delay and no fine-pointer gate.
	const handleTriggerFocus = useCallback(
		(event: ReactFocusEvent<HTMLElement>) => {
			clearTimers();
			anchorEl.current = event.currentTarget;
			openNow();
		},
		[clearTimers, openNow],
	);

	// The disclosure handle (playlist mode): click/tap/Enter toggles the card. A
	// click "pins" a card that hover may have already opened, so it survives the
	// pointer leaving; clicking a pinned card closes it.
	const handleClick = useCallback(
		(event: ReactMouseEvent<HTMLElement>) => {
			clearTimers();
			if (open && sticky.current) {
				close();
				return;
			}
			sticky.current = true;
			anchorEl.current = event.currentTarget;
			openNow();
		},
		[open, close, clearTimers, openNow],
	);

	useEffect(() => clearTimers, [clearTimers]);

	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			clearTimers();
			// Return focus to the handle when the user dismissed a pinned card, so
			// keyboard focus doesn't fall back to <body>.
			const returnFocus = sticky.current;
			const el = anchorEl.current;
			close();
			if (returnFocus) el?.focus?.();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, clearTimers, close]);

	// Keep the card glued to its anchor as the page scrolls or the window resizes.
	useEffect(() => {
		if (!open) return;
		const onReflow = () => reposition();
		window.addEventListener("scroll", onReflow, true);
		window.addEventListener("resize", onReflow);
		return () => {
			window.removeEventListener("scroll", onReflow, true);
			window.removeEventListener("resize", onReflow);
		};
	}, [open, reposition]);

	// Dismiss on a pointer-down outside both the card and its anchor — the standard
	// close for a click-opened (or lingering) card.
	useEffect(() => {
		if (!open) return;
		const onDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (previewRef.current?.contains(target)) return;
			if (anchorEl.current?.contains(target)) return;
			clearTimers();
			close();
		};
		document.addEventListener("pointerdown", onDown, true);
		return () => document.removeEventListener("pointerdown", onDown, true);
	}, [open, clearTimers, close]);

	// Lazy by default: until the card has opened once, pass null so the query key
	// resolves to tracks("") and stays disabled — no fetch for rows nobody
	// previews. `eager` (playlist mode) fetches up front instead. On enable the key
	// switches to the real id and the fetch (or cache hit) fires; React Query keeps
	// it cached so re-opening is instant.
	const enabledId = canLoadTracks && (eager || everOpened) ? playlistId : null;
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
	const previewCovers = useMemo<PlaylistPreviewCover[]>(() => {
		// One cover per album, in track order, so the fan shows variety instead of
		// three tiles of the same record.
		const byAlbum: string[] = [];
		const seen = new Set<string>();
		for (const track of tracks) {
			if (!track.imageUrl) continue;
			const key = track.albumName ?? track.imageUrl;
			if (seen.has(key)) continue;
			seen.add(key);
			byAlbum.push(track.imageUrl);
		}
		// Spotify builds a playlist's auto-mosaic cover from the first four distinct
		// album covers, so treat those as "reused" and prefer the covers past them —
		// the fan then previews art the cover doesn't already show.
		const MOSAIC_COVERS = 4;
		const fresh = byAlbum.slice(MOSAIC_COVERS);
		const freshSet = new Set(fresh);
		// Prefer fresh covers; only fall back to cover art to reach three.
		const chosen = [...fresh, ...byAlbum.slice(0, MOSAIC_COVERS)].slice(0, 3);
		// A cover reused from the playlist's own art gets marked so the UI sinks it
		// to the back of the fan instead of showing it full and up front — but only
		// when there's a fresh cover to contrast it against (a short, all-reused
		// playlist just shows its covers normally).
		return chosen
			.map((url) => ({ url, reused: fresh.length > 0 && !freshSet.has(url) }))
			.sort((a, b) => (a.reused === b.reused ? 0 : a.reused ? -1 : 1));
	}, [tracks]);
	const loadMoreTracks = useCallback(() => {
		if (tracksQuery.hasNextPage && !tracksQuery.isFetchingNextPage)
			void tracksQuery.fetchNextPage();
	}, [tracksQuery]);

	const total = songCount ?? tracks.length;

	const cursorStyle = { cursor: "default" } as const;

	const triggerProps: TriggerProps = canLoadTracks
		? {
				onPointerEnter: handleTriggerEnter,
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
				style: cursorStyle,
			}
		: {};

	const hoverProps: HoverProps = canLoadTracks
		? {
				onPointerEnter: handleTriggerEnter,
				onPointerLeave: scheduleClose,
				style: cursorStyle,
			}
		: {};

	const handleProps: HandleProps = {
		type: "button",
		onClick: handleClick,
		"aria-haspopup": "dialog",
		"aria-expanded": open,
		"aria-controls": open ? id : undefined,
	};

	const isDisclosure = interaction === "disclosure";

	const preview =
		canLoadTracks && typeof document !== "undefined"
			? createPortal(
					<AnimatePresence>
						{open && position && (
							<motion.div
								key={id}
								id={id}
								ref={previewRef}
								role={isDisclosure ? "dialog" : "tooltip"}
								aria-label={
									isDisclosure
										? (label ?? name ?? "Playlist tracks")
										: undefined
								}
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
								className="theme-surface-bg fixed z-[60] flex flex-col overflow-y-auto overscroll-contain rounded-xl px-4 py-3"
								style={{
									left: position.left,
									top: position.top,
									width: position.width,
									maxHeight: position.maxHeight,
									transformOrigin: `${position.placeLeft ? "right" : "left"} top`,
									// Layered shadow (no hard border) so the card floats naturally
									// over any surface underneath.
									boxShadow:
										"0 1px 1px color-mix(in srgb, var(--t-text) 5%, transparent), 0 10px 20px -12px color-mix(in srgb, var(--t-text) 22%, transparent), 0 28px 56px -28px color-mix(in srgb, var(--t-text) 34%, transparent)",
									willChange: "transform",
								}}
							>
								{reason && (
									// The full "what it's for" — the row clamps it to two
									// lines, so this header is where the whole intent is read.
									// Its own bottom border keeps it out of the (potentially
									// long, scrolling) track list's rhythm.
									<div className="theme-border-color mb-3 border-b pb-3">
										{name && (
											// break-words: names can be a single spaceless token
											// (e.g. "gaming+anime+vibez") that would otherwise
											// overflow the fixed-width card. text-balance evens the
											// wrap — mirrors the review-item name treatment.
											<p
												className="theme-text font-light text-balance break-words leading-[1.15]"
												style={{
													fontFamily: fonts.display,
													fontSize: "1.125rem",
												}}
											>
												{name}
											</p>
										)}
										{/* text-pretty: unclamped body copy here, so avoid a lone
										trailing word on the last line. */}
										<p
											className="theme-text-muted mt-1 text-xs leading-snug text-pretty"
											style={{ fontFamily: fonts.body }}
										>
											{reason}
										</p>
									</div>
								)}

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
										animateIn={animateRows}
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

	return {
		triggerProps,
		hoverProps,
		handleProps,
		preview,
		previewCovers,
		isOpen: open,
	};
}
