/**
 * Pick demo song step — user selects a song to demonstrate matching.
 * Full-bleed layout with horizontal-scrolling CD case grid,
 * mirroring FlagPlaylistsStep's visual treatment.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CDCase } from "@/components/ui/CDCase";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useListNavigation } from "@/lib/keyboard/useListNavigation";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import type { LandingSongManifest } from "@/lib/data/landing-songs";
import { saveDemoSongSelection } from "@/lib/server/onboarding.functions";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { useFlagPlaylistsScroll } from "../hooks/useFlagPlaylistsScroll";
import { useStepNavigation } from "../hooks/useStepNavigation";

interface PickDemoSongStepProps {
	songs: LandingSongManifest[];
}

export function PickDemoSongStep({ songs }: PickDemoSongStepProps) {
	const theme = useTheme();
	const { navigateTo } = useStepNavigation();
	const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);

	const [rowCount, setRowCount] = useState(() =>
		typeof window !== "undefined" &&
		window.matchMedia("(max-height: 1050px)").matches
			? 2
			: 3,
	);

	useEffect(() => {
		const mediaQuery = window.matchMedia("(max-height: 1050px)");
		const handleChange = (e: MediaQueryListEvent) => {
			setRowCount(e.matches ? 2 : 3);
		};
		mediaQuery.addEventListener("change", handleChange);
		return () => mediaQuery.removeEventListener("change", handleChange);
	}, []);

	const sectionRef = useRef<HTMLElement>(null);
	const pinnedWrapperRef = useRef<HTMLDivElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	const trackRef = useRef<HTMLDivElement>(null);

	useFlagPlaylistsScroll(
		{ sectionRef, pinnedWrapperRef, viewportRef, trackRef },
		{ isReady: songs.length > 0 },
	);

	const handleSongSelect = useCallback((song: LandingSongManifest) => {
		setSelectedTrackId((prev) =>
			prev === song.spotifyTrackId ? null : song.spotifyTrackId,
		);
	}, []);

	const handleSongClick = useCallback(
		(e: React.MouseEvent<HTMLButtonElement>) => {
			const trackId = e.currentTarget.dataset.trackId;
			if (trackId) {
				setSelectedTrackId((prev) => (prev === trackId ? null : trackId));
			}
		},
		[],
	);

	const { getItemProps } = useListNavigation({
		items: songs,
		scope: "onboarding-pick-demo-song",
		enabled: !isSaving && songs.length > 0,
		direction: "grid",
		rows: rowCount,
		getId: (song) => song.spotifyTrackId,
		onSelect: handleSongSelect,
	});

	const handleContinue = async () => {
		if (!selectedTrackId || isSaving) return;
		setIsSaving(true);
		try {
			await saveDemoSongSelection({
				data: { spotifyTrackId: selectedTrackId },
			});
			await navigateTo("song-walkthrough");
		} catch (error) {
			console.error("Failed to save demo song selection:", error);
			toast.error("Failed to save selection. Please try again.");
			setIsSaving(false);
		}
	};

	useShortcut({
		key: "enter",
		handler: handleContinue,
		description: "Continue",
		scope: "onboarding-pick-demo-song",
		enabled: !isSaving && selectedTrackId !== null,
	});

	const kbdVars = {
		"--kbd-text-color": theme.textMuted,
		"--kbd-bg-color": `${theme.text}10`,
		"--kbd-border-color": `${theme.textMuted}30`,
	} as React.CSSProperties;

	return (
		<section ref={sectionRef} aria-label="Song selection">
			<div ref={pinnedWrapperRef} className="flex h-dvh flex-col">
				<header className="shrink-0 px-6 pt-12 pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] md:px-12 md:pl-[max(3rem,env(safe-area-inset-left))] md:pr-[max(3rem,env(safe-area-inset-right))]">
					<p
						className="text-xs uppercase tracking-widest"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						Step 04
					</p>

					<h2
						className="mt-2 text-4xl font-extralight leading-tight md:text-6xl"
						style={{ fontFamily: fonts.display, color: theme.text }}
					>
						Pick a <em className="font-normal">song</em>
					</h2>

					<p
						className="mt-4 text-lg font-light md:text-xl"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						It'll be used to show you how hearted. listens.
					</p>

					<p className="sr-only">
						Scroll down to browse songs horizontally. Select a song to use as a
						demo.
					</p>
				</header>

				<div ref={viewportRef} className="mt-8 flex-1 overflow-hidden">
					<div ref={trackRef} className="flex h-full items-center">
						<div
							className="playlist-grid grid h-full auto-cols-[min(200px,40vw)] items-center gap-4 py-1 pl-[max(1.5rem,env(safe-area-inset-left))] md:pl-[max(3rem,env(safe-area-inset-left))]"
							style={{
								gridAutoFlow: "column",
								gridTemplateRows: `repeat(${rowCount}, 1fr)`,
							}}
						>
							{songs.map((song, index) => {
								const isSelected = selectedTrackId === song.spotifyTrackId;
								const itemProps = getItemProps(song, index);
								const isFocused = itemProps["data-focused"];

								return (
									<button
										key={song.spotifyTrackId}
										type="button"
										ref={itemProps.ref}
										tabIndex={itemProps.tabIndex}
										data-focused={itemProps["data-focused"]}
										data-nav-engaged={itemProps["data-nav-engaged"]}
										onPointerDown={itemProps.onPointerDown}
										onFocus={itemProps.onFocus}
										onBlur={itemProps.onBlur}
										data-track-id={song.spotifyTrackId}
										onClick={handleSongClick}
										aria-pressed={isSelected}
										aria-label={`${isSelected ? "Deselect" : "Select"} ${song.name} by ${song.artist}`}
										title={`${song.name} — ${song.artist}`}
										className="group relative h-fit min-h-11 min-w-11"
										style={{
											...(isFocused && {
												outline: `2px dashed ${theme.textMuted}`,
												outlineOffset: "2px",
											}),
										}}
									>
										<div
											className="transition-all duration-300"
											style={{
												filter: isSelected
													? "grayscale(0%)"
													: "grayscale(100%)",
												opacity: isSelected ? 1 : 0.35,
											}}
										>
											<CDCase
												src={song.albumArtUrl}
												alt={`${song.name} by ${song.artist}`}
											/>
										</div>
										<div className="mt-2 min-w-0 max-w-full">
											<p
												className="truncate text-sm font-medium"
												style={{
													fontFamily: fonts.body,
													color: theme.text,
													opacity: isSelected ? 1 : 0.6,
												}}
											>
												{song.name}
											</p>
											<p
												className="truncate text-xs"
												style={{
													fontFamily: fonts.body,
													color: theme.textMuted,
													opacity: isSelected ? 1 : 0.5,
												}}
											>
												{song.artist}
											</p>
										</div>
									</button>
								);
							})}
						</div>
						<div className="h-full w-6 shrink-0 md:w-12" aria-hidden="true" />
					</div>
				</div>

				<footer className="flex shrink-0 flex-wrap gap-4 px-6 pb-[max(3rem,env(safe-area-inset-bottom))] pt-6 pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] md:px-12 md:pl-[max(3rem,env(safe-area-inset-left))] md:pr-[max(3rem,env(safe-area-inset-right))]">
					<button
						type="button"
						onClick={handleContinue}
						disabled={isSaving || selectedTrackId === null}
						className="group inline-flex min-h-11 items-center gap-3"
						style={{
							fontFamily: fonts.body,
							color: theme.text,
							opacity: isSaving || selectedTrackId === null ? 0.5 : 1,
						}}
					>
						<span className="text-lg font-medium tracking-wide">
							{isSaving ? "Saving..." : "Continue"}
						</span>
						<span
							className="inline-block transition-transform group-hover:translate-x-1"
							style={{ color: theme.textMuted }}
						>
							→
						</span>
					</button>

					<div
						className="ml-auto flex items-center gap-6"
						style={{
							color: theme.textMuted,
							opacity: 0.6,
							...kbdVars,
						}}
					>
						<div className="flex items-center gap-1.5">
							<KbdGroup>
								<Kbd>↑</Kbd>
								<Kbd>↓</Kbd>
								<Kbd>←</Kbd>
								<Kbd>→</Kbd>
							</KbdGroup>
							<span className="text-xs">navigate</span>
						</div>
						<div className="flex items-center gap-1.5">
							<Kbd>Space</Kbd>
							<span className="text-xs">select</span>
						</div>
						<div className="flex items-center gap-1.5">
							<Kbd>⏎</Kbd>
							<span className="text-xs">continue</span>
						</div>
					</div>
				</footer>
			</div>
		</section>
	);
}
