/**
 * Component: SongDetailPanel
 *
 * Full-screen overlay showing song details with analysis.
 * Features:
 * - Hero header with scroll-driven collapse (450px -> 108px)
 * - All detail sections: audio info, meaning, context, playlists
 * - View Transition integration
 * - Mobile: 100vw full-screen
 * - Reduced motion support
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/useTheme";
import { getDarkTheme } from "@/lib/theme/colors";
import { DEFAULT_THEME } from "@/lib/theme/types";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { useArtistImage } from "@/lib/hooks/useArtistImage";
import type { SongDetailPanelProps } from "../types";
import { formatRelativeTime, isNewSong } from "../types";
import {
	Nav,
	AudioInfo,
	MeaningSection,
	ContextSection,
	PlaylistsSection,
} from "./detail";

const HERO_FULL_HEIGHT = 450;
const HERO_COLLAPSED_HEIGHT = 108;
const SCROLL_THRESHOLD = 100;

function prefersReducedMotion(): boolean {
	if (typeof window === "undefined") return false;
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function SongDetailPanel({
	song,
	albumArtUrl,
	artistImageUrl: propArtistImageUrl,
	isExpanded,
	startRect: _startRect,
	onClose,
	onNext,
	onPrevious,
	hasNext,
	hasPrevious,
}: SongDetailPanelProps) {
	const { theme } = useTheme(DEFAULT_THEME);
	const darkTheme = getDarkTheme(theme);

	const { artistImageUrl: fetchedArtistImageUrl } = useArtistImage(
		song.track.spotify_id,
		{ enabled: isExpanded && !propArtistImageUrl },
	);

	const artistImageUrl = propArtistImageUrl || fetchedArtistImageUrl;
	const hasArtistImage = !!artistImageUrl;
	const heroTheme = hasArtistImage ? darkTheme : theme;

	const panelRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);

	const [heroHeight, setHeroHeight] = useState(HERO_FULL_HEIGHT);
	const [isJourneyExpanded, setIsJourneyExpanded] = useState(false);
	const [isOtherPlaylistsExpanded, setIsOtherPlaylistsExpanded] =
		useState(false);
	const [addedToPlaylists, setAddedToPlaylists] = useState<number[]>([]);

	useEffect(() => {
		if (isExpanded) {
			setHeroHeight(HERO_FULL_HEIGHT);
			setIsJourneyExpanded(false);
			setIsOtherPlaylistsExpanded(false);
			setAddedToPlaylists([]);
			if (scrollRef.current) {
				scrollRef.current.scrollTop = 0;
			}
		}
	}, [isExpanded]);

	const handleScroll = useCallback(() => {
		if (!scrollRef.current || prefersReducedMotion()) return;

		const scrollTop = scrollRef.current.scrollTop;
		const progress = Math.min(scrollTop / SCROLL_THRESHOLD, 1);
		const newHeight =
			HERO_FULL_HEIGHT - progress * (HERO_FULL_HEIGHT - HERO_COLLAPSED_HEIGHT);
		setHeroHeight(newHeight);
	}, []);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		el.addEventListener("scroll", handleScroll, { passive: true });
		return () => el.removeEventListener("scroll", handleScroll);
	}, [handleScroll]);

	useShortcut({
		key: "escape",
		handler: onClose,
		description: "Close detail panel",
		scope: "liked-detail",
		category: "actions",
		enabled: isExpanded,
	});

	useShortcut({
		key: "j",
		handler: onNext,
		description: "Next song",
		scope: "liked-detail",
		category: "navigation",
		enabled: isExpanded && hasNext,
	});

	useShortcut({
		key: "k",
		handler: onPrevious,
		description: "Previous song",
		scope: "liked-detail",
		category: "navigation",
		enabled: isExpanded && hasPrevious,
	});

	const analysis = song.analysis?.analysis;
	const audioFeatures = analysis?.audio_features;
	const emotional = analysis?.emotional;
	const themes = analysis?.meaning?.themes;
	const journey = emotional?.journey;
	const bestMoments = analysis?.context?.best_moments;

	const mockPlaylists = [
		{
			id: 1,
			name: "Chill Vibes",
			matchScore: 0.92,
			reason: "Similar mood and tempo",
		},
		{
			id: 2,
			name: "Late Night",
			matchScore: 0.85,
			reason: "Matching energy level",
		},
		{
			id: 3,
			name: "Focus",
			matchScore: 0.65,
			reason: "Instrumental qualities",
		},
		{ id: 4, name: "Party Mix", matchScore: 0.45, reason: "Genre overlap" },
	];

	const handleAddToPlaylist = useCallback((playlistId: number) => {
		setAddedToPlaylists((prev) => [...prev, playlistId]);
	}, []);

	const handleSkip = useCallback(() => {
		onClose();
	}, [onClose]);

	const handleMarkSorted = useCallback(() => {
		onClose();
	}, [onClose]);

	if (!isExpanded) return null;

	const isNew = isNewSong(song.liked_at);
	const isCollapsed = heroHeight <= HERO_COLLAPSED_HEIGHT + 20;

	return (
		<div
			ref={panelRef}
			className="fixed inset-0 z-50 flex flex-col overflow-hidden lg:left-auto lg:w-[600px]"
			style={{
				background: theme.bg,
			}}
		>
			<div
				ref={scrollRef}
				className="flex-1 overflow-y-auto overscroll-contain"
			>
				<header
					className="sticky top-0 z-10 overflow-hidden transition-all"
					style={{
						height: heroHeight,
						minHeight: HERO_COLLAPSED_HEIGHT,
					}}
				>
					{hasArtistImage && (
						<div
							className="absolute inset-0"
							style={{
								backgroundImage: `url(${artistImageUrl})`,
								backgroundSize: "cover",
								backgroundPosition: "center top",
								filter: "brightness(0.4)",
							}}
						/>
					)}

					<div
						className="absolute inset-x-0 bottom-0 h-32"
						style={{
							background: hasArtistImage
								? `linear-gradient(to top, ${theme.bg}, transparent)`
								: "transparent",
						}}
					/>

					<div className="relative z-10 flex h-full flex-col justify-between p-6">
						<div className="flex items-start justify-between">
							<AudioInfo
								theme={heroTheme}
								audioFeatures={audioFeatures}
								isDark={hasArtistImage}
							/>
							<Nav
								theme={heroTheme}
								onClose={onClose}
								onNext={onNext}
								onPrevious={onPrevious}
								hasNext={hasNext}
								hasPrevious={hasPrevious}
								isDark={hasArtistImage}
							/>
						</div>

						<div
							className="transition-all duration-200"
							style={{
								opacity: isCollapsed ? 1 : 0,
								transform: isCollapsed ? "translateY(0)" : "translateY(10px)",
							}}
						>
							{isCollapsed && (
								<div className="flex items-center gap-3">
									{albumArtUrl && (
										<img
											src={albumArtUrl}
											alt=""
											className="h-12 w-12 object-cover"
										/>
									)}
									<div className="min-w-0 flex-1">
										<h1
											className="truncate text-lg"
											style={{
												fontFamily: fonts.display,
												color: hasArtistImage ? "white" : theme.text,
											}}
										>
											{song.track.name}
										</h1>
										<p
											className="truncate text-sm"
											style={{
												fontFamily: fonts.body,
												color: hasArtistImage
													? "rgba(255,255,255,0.7)"
													: theme.textMuted,
											}}
										>
											{song.track.artist}
										</p>
									</div>
								</div>
							)}
						</div>

						<div
							className="transition-all duration-200"
							style={{
								opacity: isCollapsed ? 0 : 1,
								transform: isCollapsed ? "translateY(-10px)" : "translateY(0)",
							}}
						>
							<div className="mb-4 flex items-center gap-4">
								{albumArtUrl && (
									<img
										src={albumArtUrl}
										alt=""
										className="h-20 w-20 object-cover shadow-lg"
										style={{
											viewTransitionName: "song-album",
										}}
									/>
								)}
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										{isNew && (
											<span
												className="px-2 py-0.5 text-[10px] tracking-wider uppercase"
												style={{
													fontFamily: fonts.body,
													background: hasArtistImage
														? "rgba(255,255,255,0.2)"
														: theme.surfaceDim,
													color: hasArtistImage ? "white" : theme.text,
												}}
											>
												New
											</span>
										)}
										<span
											className="text-xs"
											style={{
												fontFamily: fonts.body,
												color: hasArtistImage
													? "rgba(255,255,255,0.5)"
													: theme.textMuted,
											}}
										>
											{formatRelativeTime(song.liked_at)}
										</span>
									</div>

									<h1
										className="mt-2 text-2xl leading-tight lg:text-3xl"
										style={{
											fontFamily: fonts.display,
											color: hasArtistImage ? "white" : theme.text,
											viewTransitionName: "song-title",
										}}
									>
										{song.track.name}
									</h1>
									<p
										className="mt-1 text-base lg:text-lg"
										style={{
											fontFamily: fonts.body,
											color: hasArtistImage
												? "rgba(255,255,255,0.8)"
												: theme.textMuted,
											viewTransitionName: "song-artist",
										}}
									>
										{song.track.artist}
									</p>
								</div>
							</div>
						</div>
					</div>
				</header>

				<main className="space-y-8 p-6 pt-4" style={{ background: theme.bg }}>
					<MeaningSection
						theme={theme}
						emotional={emotional}
						themes={themes}
						journey={journey}
						isJourneyExpanded={isJourneyExpanded}
						onToggleJourney={() => setIsJourneyExpanded((p) => !p)}
					/>

					<ContextSection theme={theme} bestMoments={bestMoments} />

					<PlaylistsSection
						theme={theme}
						playlists={mockPlaylists}
						addedTo={addedToPlaylists}
						isOtherExpanded={isOtherPlaylistsExpanded}
						onAdd={handleAddToPlaylist}
						onToggleOther={() => setIsOtherPlaylistsExpanded((p) => !p)}
						onSkip={handleSkip}
						onMarkSorted={handleMarkSorted}
					/>
				</main>

				<div className="h-32" />
			</div>
		</div>
	);
}
