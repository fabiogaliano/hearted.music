/**
 * Pick demo song step — user selects a song to demonstrate matching.
 * Single-select grid with grayscale/full-color toggle.
 */

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useListNavigation } from "@/lib/keyboard/useListNavigation";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import type { LandingSongManifest } from "@/lib/data/landing-songs";
import { saveDemoSongSelection } from "@/lib/server/onboarding.functions";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";

interface PickDemoSongStepProps {
	songs: LandingSongManifest[];
}

export function PickDemoSongStep({ songs }: PickDemoSongStepProps) {
	const theme = useTheme();
	const { goToStep } = useOnboardingNavigation();
	const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);

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
		columns: 4,
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
			await goToStep("song-showcase");
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
		<div className="text-center">
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

			<div className="mx-auto mt-8 grid max-w-2xl grid-cols-3 gap-4 sm:grid-cols-4">
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
							className="group flex flex-col items-center gap-2 rounded-lg p-2 transition-all"
							style={{
								...(isFocused && {
									outline: `2px dashed ${theme.textMuted}`,
									outlineOffset: "2px",
								}),
							}}
						>
							<div
								className="aspect-square w-full overflow-hidden rounded-md transition-all duration-300"
								style={{
									filter: isSelected ? "grayscale(0%)" : "grayscale(100%)",
									opacity: isSelected ? 1 : 0.4,
								}}
							>
								<img
									src={song.albumArtUrl}
									alt={`${song.name} album art`}
									className="h-full w-full object-cover"
								/>
							</div>
							<div className="min-w-0 max-w-full">
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

			<button
				type="button"
				onClick={handleContinue}
				disabled={isSaving || selectedTrackId === null}
				className="group mt-12 inline-flex min-h-11 items-center gap-3"
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
				className="mt-6 flex items-center justify-center gap-6"
				style={{ color: theme.textMuted, opacity: 0.6, ...kbdVars }}
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
		</div>
	);
}
