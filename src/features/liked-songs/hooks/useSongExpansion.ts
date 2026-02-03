/**
 * Hook: useSongExpansion
 *
 * Handles FLIP animation (First, Last, Invert, Play) for smooth song expansion
 * from list into full detail view - mirrors usePlaylistExpansion pattern.
 *
 * URL Sync Strategy: Uses TanStack Router search params
 * - Updates URL via navigate({ search: ... })
 * - TanStack Router handles browser back/forward automatically
 * - initialSlug prop used for deep linking on page load
 *
 * This is the standard pattern for modals/panels with URLs (Linear, Notion, etc.)
 */

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { generateSongSlug } from "@/lib/utils/slug";

import type { LikedSong } from "../types";

// Helper: Check if View Transitions API is supported
const supportsViewTransitions =
	typeof document !== "undefined" && "startViewTransition" in document;

// Helper: Run callback with View Transition if supported
// Returns a promise that resolves when the transition animation completes
function withViewTransition(callback: () => void): Promise<void> {
	if (supportsViewTransitions) {
		const transition = (document as any).startViewTransition(() => {
			flushSync(callback);
		});
		// Return the finished promise - resolves when animation completes
		return transition.finished;
	} else {
		callback();
		return Promise.resolve();
	}
}

interface StartRect {
	top: number;
	left: number;
	width: number;
	height: number;
}

interface UseSongExpansionOptions {
	/** Initial slug from URL (for deep linking on page load) */
	initialSlug?: string | null;
}

export function useSongExpansion(
	songs: LikedSong[],
	options: UseSongExpansionOptions = {},
) {
	const { initialSlug } = options;
	const navigate = useNavigate();
	const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
	const [isExpanded, setIsExpanded] = useState(false);
	const [startRect, setStartRect] = useState<StartRect | null>(null);
	// Track the song ID we're animating back to during close (for view transitions)
	const [closingToSongId, setClosingToSongId] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const isInitialized = useRef(false);

	// Get the currently selected song
	const selectedSong = selectedSongId
		? (songs.find((s) => s.track.id === selectedSongId) ?? null)
		: null;

	// Get index for navigation
	const selectedIndex = selectedSong
		? songs.findIndex((s) => s.track.id === selectedSong.track.id)
		: -1;

	const hasNext = selectedIndex >= 0 && selectedIndex < songs.length - 1;
	const hasPrevious = selectedIndex > 0;

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

	// Handle initial slug from URL (deep linking on page load)
	useEffect(() => {
		if (isInitialized.current || songs.length === 0) return;
		isInitialized.current = true;

		if (initialSlug) {
			const song = songs.find(
				(s) => generateSongSlug(s.track.artist, s.track.name) === initialSlug,
			);
			if (song) {
				setSelectedSongId(song.track.id);
				// Set default rect for deep-linked expansion (center of viewport)
				setStartRect({
					top: window.innerHeight / 2,
					left: window.innerWidth / 2,
					width: 0,
					height: 0,
				});
				// Delay expansion slightly to allow layout
				requestAnimationFrame(() => {
					setIsExpanded(true);
				});
			}
		}
	}, [initialSlug, songs]);

	// Trigger expansion animation
	const handleExpand = useCallback(
		(song: LikedSong, e: React.MouseEvent<HTMLElement>) => {
			const itemRect = e.currentTarget.getBoundingClientRect();
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
