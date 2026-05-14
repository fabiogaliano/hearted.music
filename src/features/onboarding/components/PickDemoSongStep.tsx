/**
 * Pick demo song step — user selects a song to demonstrate matching.
 * Full-bleed layout with horizontal-scrolling CD case grid,
 * mirroring FlagPlaylistsStep's visual treatment.
 */

import { ArrowRight } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { CDCase } from "@/components/ui/CDCase";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import type { LandingSongManifest } from "@/lib/data/landing-songs";
import { useListNavigation } from "@/lib/keyboard/useListNavigation";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import {
	commitDemoSongAndEnterWalkthrough,
	type OnboardingAuthPayload,
} from "@/lib/server/onboarding.functions";
import { fonts } from "@/lib/theme/fonts";
import { useFlagPlaylistsScroll } from "../hooks/useFlagPlaylistsScroll";

interface PickDemoSongStepProps {
	songs: LandingSongManifest[];
}

const ONBOARDING_SESSION_QUERY_KEY = ["auth", "onboarding-session"] as const;

export function PickDemoSongStep({ songs }: PickDemoSongStepProps) {
	const queryClient = useQueryClient();
	const router = useRouter();
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
			// Atomic server transition: writes demo_song_id + onboarding_step in
			// one UPDATE, then returns the full new session. Replacing the cache
			// with this authoritative payload before navigating is what prevents
			// the /onboarding ↔ /liked-songs redirect loop — route guards read a
			// fully-consistent session, never a partially-patched one.
			const nextPayload: OnboardingAuthPayload =
				await commitDemoSongAndEnterWalkthrough({
					data: { spotifyTrackId: selectedTrackId },
				});

			queryClient.setQueryData<OnboardingAuthPayload>(
				ONBOARDING_SESSION_QUERY_KEY,
				nextPayload,
			);

			await router.navigate({ to: "/liked-songs", search: { filter: "all" } });
		} catch (error) {
			console.error("Failed to commit demo song walkthrough:", error);
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

	return (
		<section ref={sectionRef} aria-label="Song selection">
			<div ref={pinnedWrapperRef} className="flex h-dvh flex-col">
				<header className="shrink-0 px-6 pt-12 pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] md:px-12 md:pl-[max(3rem,env(safe-area-inset-left))] md:pr-[max(3rem,env(safe-area-inset-right))]">
					<h2
						className="theme-text text-4xl font-extralight leading-tight md:text-6xl"
						style={{ fontFamily: fonts.display }}
					>
						Pick a <em className="font-normal">song</em>
					</h2>

					<p
						className="theme-text-muted mt-4 text-lg font-light md:text-xl"
						style={{ fontFamily: fonts.body }}
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
										className="group relative h-fit min-h-11 min-w-11 cursor-pointer"
										style={{
											...(isFocused && {
												outline: "1px dashed var(--t-text-muted)",
												outlineOffset: "2px",
											}),
										}}
									>
										<div
											className="transition-[filter,opacity] duration-200"
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
												className="theme-text truncate text-sm font-medium"
												style={{
													fontFamily: fonts.body,
													opacity: isSelected ? 1 : 0.6,
												}}
											>
												{song.name}
											</p>
											<p
												className="theme-text-muted truncate text-xs"
												style={{
													fontFamily: fonts.body,
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
					<Button
						variant="link"
						onClick={handleContinue}
						disabled={isSaving || selectedTrackId === null}
						style={{ fontFamily: fonts.body }}
					>
						<span className="text-lg font-medium tracking-wide">
							{isSaving ? "Saving..." : "Continue"}
						</span>
						<ArrowRight
							size={16}
							className="theme-text-muted inline-block transition-transform group-hover:translate-x-1"
						/>
					</Button>

					<div className="theme-kbd-scope ml-auto flex items-center gap-6 opacity-60">
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
