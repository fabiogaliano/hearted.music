/**
 * Hook: useSongExpansion
 *
 * Handles FLIP animation (First, Last, Invert, Play) for smooth song expansion
 * from list into full detail view - mirrors usePlaylistExpansion pattern.
 *
 * URL Sync Strategy: Uses TanStack Router search params
 * - Updates URL via navigate({ search: ... })
 * - TanStack Router handles browser back/forward automatically
 * - selectedSlug prop keeps local state in sync with deep links and browser navigation
 *
 * This is the standard pattern for modals/panels with URLs (Linear, Notion, etc.)
 */

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { generateSongSlug } from "@/lib/utils/slug";

import type { LikedSong } from "../types";

const supportsViewTransitions =
	typeof document !== "undefined" && "startViewTransition" in document;

interface ViewTransitionDocument {
	startViewTransition: (callback: () => void) => { finished: Promise<void> };
}

function withViewTransition(callback: () => void): Promise<void> {
	if (supportsViewTransitions) {
		const transition = (
			document as unknown as ViewTransitionDocument
		).startViewTransition(() => {
			flushSync(callback);
		});
		return transition.finished;
	}

	callback();
	return Promise.resolve();
}

interface StartRect {
	top: number;
	left: number;
	width: number;
	height: number;
}

interface UseSongExpansionOptions {
	/** Selected slug from URL (supports deep links and browser navigation) */
	selectedSlug?: string | null;
	/** Song resolved outside the loaded list, e.g. via direct slug lookup */
	fallbackSelectedSong?: LikedSong | null;
	/** Whether the current selected slug has finished resolving */
	isSelectedSlugResolved?: boolean;
}

function findSongForSlug(
	songs: LikedSong[],
	slug: string | null | undefined,
): LikedSong | null {
	if (!slug) return null;

	return (
		songs.find(
			(candidate) =>
				generateSongSlug(candidate.track.artist, candidate.track.name) === slug,
		) ?? null
	);
}

function songMatchesSlug(
	song: LikedSong,
	slug: string | null | undefined,
): boolean {
	if (!slug) {
		return false;
	}

	return generateSongSlug(song.track.artist, song.track.name) === slug;
}

export function useSongExpansion(
	songs: LikedSong[],
	options: UseSongExpansionOptions = {},
) {
	const { selectedSlug, fallbackSelectedSong = null } = options;
	const navigate = useNavigate();
	const routeSelectedSongFromList = findSongForSlug(songs, selectedSlug);
	const routeSelectedSong =
		routeSelectedSongFromList ??
		(fallbackSelectedSong !== null &&
		songMatchesSlug(fallbackSelectedSong, selectedSlug)
			? fallbackSelectedSong
			: null);
	const routeSelectedSongId = routeSelectedSong?.track.id ?? null;
	const isSelectedSlugResolved =
		options.isSelectedSlugResolved ??
		(selectedSlug == null || routeSelectedSongId !== null || songs.length > 0);
	const [selectedSongId, setSelectedSongId] = useState<string | null>(
		routeSelectedSongId,
	);
	const [isExpanded, setIsExpanded] = useState(routeSelectedSongId !== null);
	const [startRect, setStartRect] = useState<StartRect | null>(null);
	// Track the song ID we're animating back to during close (for view transitions)
	const [closingToSongId, setClosingToSongId] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const isClosingRef = useRef(false);

	// Derive selected song + index in a single pass
	const { selectedSong, selectedIndex } = useMemo(() => {
		if (!selectedSongId) return { selectedSong: null, selectedIndex: -1 };
		const idx = songs.findIndex((s) => s.track.id === selectedSongId);
		if (idx >= 0) {
			return {
				selectedSong: songs[idx],
				selectedIndex: idx,
			};
		}

		if (fallbackSelectedSong?.track.id === selectedSongId) {
			return {
				selectedSong: fallbackSelectedSong,
				selectedIndex: -1,
			};
		}

		return { selectedSong: null, selectedIndex: -1 };
	}, [fallbackSelectedSong, songs, selectedSongId]);

	const hasNext = selectedIndex >= 0 && selectedIndex < songs.length - 1;
	const hasPrevious = selectedIndex > 0;

	useEffect(() => {
		if (!selectedSlug) {
			if (isClosingRef.current || selectedSongId === null) return;
			setIsExpanded(false);
			setSelectedSongId(null);
			setStartRect(null);
			setClosingToSongId(null);
			return;
		}

		if (!routeSelectedSongId) {
			if (!isSelectedSlugResolved || isClosingRef.current) return;
			setIsExpanded(false);
			setSelectedSongId(null);
			setStartRect(null);
			setClosingToSongId(null);
			return;
		}

		if (routeSelectedSongId === selectedSongId) return;

		setStartRect(null);
		setClosingToSongId(null);
		setSelectedSongId(routeSelectedSongId);
		setIsExpanded(true);
	}, [
		isSelectedSlugResolved,
		routeSelectedSongId,
		selectedSlug,
		selectedSongId,
	]);

	// Helper: Update URL via TanStack Router search params
	const updateUrl = useCallback(
		(slug: string | null) => {
			void navigate({
				to: ".",
				search: (prev: { song?: string }) => ({
					...prev,
					song: slug ?? undefined,
				}),
				replace: false,
			});
		},
		[navigate],
	);

	// Trigger expansion animation
	const handleExpand = useCallback(
		(song: LikedSong, element: HTMLElement) => {
			const itemRect = element.getBoundingClientRect();
			const slug = generateSongSlug(song.track.artist, song.track.name);

			// Set state and update URL
			setStartRect({
				top: itemRect.top,
				left: itemRect.left,
				width: itemRect.width,
				height: itemRect.height,
			});
			setSelectedSongId(song.track.id);
			updateUrl(slug);

			// Start expansion animation
			requestAnimationFrame(() => {
				setIsExpanded(true);
			});
		},
		[updateUrl],
	);

	// Navigate to next song (maintains expansion)
	const handleNext = useCallback(() => {
		if (hasNext && selectedIndex >= 0) {
			const nextSong = songs[selectedIndex + 1];
			const slug = generateSongSlug(nextSong.track.artist, nextSong.track.name);
			setSelectedSongId(nextSong.track.id);
			updateUrl(slug);
		}
	}, [hasNext, selectedIndex, songs, updateUrl]);

	// Navigate to previous song (maintains expansion)
	const handlePrevious = useCallback(() => {
		if (hasPrevious && selectedIndex >= 0) {
			const prevSong = songs[selectedIndex - 1];
			const slug = generateSongSlug(prevSong.track.artist, prevSong.track.name);
			setSelectedSongId(prevSong.track.id);
			updateUrl(slug);
		}
	}, [hasPrevious, selectedIndex, songs, updateUrl]);

	// Trigger collapse animation and cleanup
	const handleClose = useCallback(async () => {
		const targetId = selectedSongId;
		isClosingRef.current = true;
		updateUrl(null);

		// Use View Transitions API for smooth shared element animation
		//
		// The sequence matters for view-transition-name handoff:
		// 1. OLD snapshot taken: Panel has names (song-album, song-title, song-artist)
		//    Card has 'none' (because closingToSongId not set yet)
		// 2. State updates run inside callback (via flushSync):
		//    - setClosingToSongId(targetId) → Card gets the names
		//    - setIsExpanded(false) → Panel loses the names
		// 3. NEW snapshot taken: Card has names, Panel has 'none'
		// 4. Browser morphs from panel elements to card elements
		//
		// IMPORTANT: Panel must remain mounted during transition (don't set selectedSongId=null here)
		await withViewTransition(() => {
			setClosingToSongId(targetId);
			setIsExpanded(false);
		});

		// Clear state AFTER the view transition animation completes
		// The await above ensures we wait for the browser's .finished promise
		setSelectedSongId(null);
		setStartRect(null);
		setClosingToSongId(null);
		isClosingRef.current = false;
	}, [selectedSongId, updateUrl]);

	return {
		selectedSong,
		selectedSongId,
		isExpanded,
		startRect,
		containerRef,
		hasNext,
		hasPrevious,
		handleExpand,
		handleNext,
		handlePrevious,
		handleClose,
		// For view transitions: which card to animate to during close
		closingToSongId,
	};
}
