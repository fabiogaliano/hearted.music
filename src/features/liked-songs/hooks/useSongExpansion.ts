/**
 * Hook: useSongExpansion
 *
 * Handles View Transitions API for smooth song expansion from list to detail.
 *
 * URL Sync Strategy: Uses window.history.pushState for "shallow routing"
 * - Updates URL without triggering React Router navigation
 * - Keeps animation state local (no remounts)
 * - Listens to popstate for browser back/forward
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { generateSongSlug, type LikedSong } from "../types";

const supportsViewTransitions =
	typeof document !== "undefined" && "startViewTransition" in document;

function withViewTransition(callback: () => void): Promise<void> {
	if (supportsViewTransitions && document.startViewTransition) {
		const transition = document.startViewTransition(() => {
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
	basePath?: string;
	initialSlug?: string | null;
}

export function useSongExpansion(
	songs: LikedSong[],
	options: UseSongExpansionOptions = {},
) {
	const { basePath = "/dashboard/liked-songs", initialSlug } = options;
	const navigate = useNavigate();
	const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
	const [isExpanded, setIsExpanded] = useState(false);
	const [startRect, setStartRect] = useState<StartRect | null>(null);
	const [closingToSongId, setClosingToSongId] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const isInitialized = useRef(false);

	const selectedSong = selectedSongId
		? (songs.find((s) => s.track.id === selectedSongId) ?? null)
		: null;

	const selectedIndex = selectedSong
		? songs.findIndex((s) => s.track.id === selectedSong.track.id)
		: -1;

	const hasNext = selectedIndex >= 0 && selectedIndex < songs.length - 1;
	const hasPrevious = selectedIndex > 0;

	const updateUrl = useCallback(
		(slug: string | null) => {
			if (slug) {
				navigate({
					to: basePath,
					search: (prev) => ({ ...prev, song: slug }),
					replace: false,
				});
			} else {
				navigate({
					to: basePath,
					search: (prev) => {
						const { song: _song, ...rest } = prev as Record<string, unknown>;
						return rest;
					},
					replace: false,
				});
			}
		},
		[basePath, navigate],
	);

	useEffect(() => {
		if (isInitialized.current || songs.length === 0) return;
		isInitialized.current = true;

		if (initialSlug) {
			const song = songs.find(
				(s) => generateSongSlug(s.track.artist, s.track.name) === initialSlug,
			);
			if (song) {
				setSelectedSongId(song.track.id);
				setStartRect({
					top: window.innerHeight / 2,
					left: window.innerWidth / 2,
					width: 0,
					height: 0,
				});
				requestAnimationFrame(() => {
					setIsExpanded(true);
				});
			}
		}
	}, [initialSlug, songs]);

	useEffect(() => {
		const handlePopState = () => {
			const params = new URLSearchParams(window.location.search);
			const slug = params.get("song");

			if (slug && songs.length > 0) {
				const song = songs.find(
					(s) => generateSongSlug(s.track.artist, s.track.name) === slug,
				);
				if (song) {
					setSelectedSongId(song.track.id);
					if (!isExpanded) {
						setStartRect({
							top: window.innerHeight / 2,
							left: window.innerWidth / 2,
							width: 0,
							height: 0,
						});
						setIsExpanded(true);
					}
				}
			} else {
				setIsExpanded(false);
				setTimeout(() => {
					setSelectedSongId(null);
					setStartRect(null);
				}, 350);
			}
		};

		window.addEventListener("popstate", handlePopState);
		return () => window.removeEventListener("popstate", handlePopState);
	}, [songs, isExpanded]);

	const handleExpand = useCallback(
		(song: LikedSong, e: React.MouseEvent<HTMLElement>) => {
			const itemRect = e.currentTarget.getBoundingClientRect();
			const slug = generateSongSlug(song.track.artist, song.track.name);

			setStartRect({
				top: itemRect.top,
				left: itemRect.left,
				width: itemRect.width,
				height: itemRect.height,
			});
			setSelectedSongId(song.track.id);
			updateUrl(slug);

			requestAnimationFrame(() => {
				setIsExpanded(true);
			});
		},
		[updateUrl],
	);

	const handleNext = useCallback(() => {
		if (hasNext && selectedIndex >= 0) {
			const nextSong = songs[selectedIndex + 1];
			const slug = generateSongSlug(nextSong.track.artist, nextSong.track.name);
			setSelectedSongId(nextSong.track.id);
			updateUrl(slug);
		}
	}, [hasNext, selectedIndex, songs, updateUrl]);

	const handlePrevious = useCallback(() => {
		if (hasPrevious && selectedIndex >= 0) {
			const prevSong = songs[selectedIndex - 1];
			const slug = generateSongSlug(prevSong.track.artist, prevSong.track.name);
			setSelectedSongId(prevSong.track.id);
			updateUrl(slug);
		}
	}, [hasPrevious, selectedIndex, songs, updateUrl]);

	const handleClose = useCallback(async () => {
		const targetId = selectedSongId;
		updateUrl(null);

		await withViewTransition(() => {
			setClosingToSongId(targetId);
			setIsExpanded(false);
		});

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
		closingToSongId,
	};
}
