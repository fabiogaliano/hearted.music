/**
 * Flag Playlists step - select destination playlists.
 * Full-bleed layout with horizontal-scrolling playlist grid.
 *
 * Uses scroll-jacking: vertical scroll → horizontal playlist movement.
 * Playlists stack in max 3 rows, extending horizontally in columns.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { toast } from "sonner";
import { useListNavigation } from "@/lib/keyboard/useListNavigation";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import {
	savePlaylistDestinations,
	type OnboardingPlaylist,
} from "@/lib/server/onboarding.server";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";
import { useFlagPlaylistsScroll } from "../hooks/useFlagPlaylistsScroll";
import { CDCase } from "@/components/ui/CDCase";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import "../types"; // Ensure HistoryState augmentation is loaded

interface FlagPlaylistsStepProps {
	theme: ThemeConfig;
	playlists: OnboardingPlaylist[];
}

/** Fallback for syncStats when navigation state is lost (e.g., page refresh) */
const EMPTY_SYNC_STATS = { songs: 0, playlists: 0 } as const;

export function FlagPlaylistsStep({
	theme,
	playlists: initialPlaylists,
}: FlagPlaylistsStepProps) {
	const { goToStep } = useOnboardingNavigation();
	const location = useLocation();
	const syncStats = location.state?.syncStats ?? EMPTY_SYNC_STATS;
	const [selectedIds, setSelectedIds] = useState<Set<string>>(
		() =>
			new Set(initialPlaylists.filter((p) => p.isDestination).map((p) => p.id)),
	);
	const [isSaving, setIsSaving] = useState(false);

	const [rowCount, setRowCount] = useState(3);

	useEffect(() => {
		const mediaQuery = window.matchMedia("(max-height: 900px)");

		const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
			setRowCount(e.matches ? 2 : 3);
		};

		handleChange(mediaQuery);

		mediaQuery.addEventListener("change", handleChange);
		return () => mediaQuery.removeEventListener("change", handleChange);
	}, []);

	const sectionRef = useRef<HTMLElement>(null);
	const pinnedWrapperRef = useRef<HTMLDivElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	const trackRef = useRef<HTMLDivElement>(null);

	useFlagPlaylistsScroll(
		{ sectionRef, pinnedWrapperRef, viewportRef, trackRef },
		{ isReady: initialPlaylists.length > 0 },
	);

	const togglePlaylist = useCallback((id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	}, []);

	// Space toggles selection; Enter continues (separation enables keyboard-only flow)
	const handlePlaylistSelect = useCallback(
		(playlist: OnboardingPlaylist) => {
			togglePlaylist(playlist.id);
		},
		[togglePlaylist],
	);

	// Single click handler for all playlist buttons (avoids creating closures in loop)
	const handlePlaylistClick = useCallback(
		(e: React.MouseEvent<HTMLButtonElement>) => {
			const id = e.currentTarget.dataset.playlistId;
			if (id) togglePlaylist(id);
		},
		[togglePlaylist],
	);

	const { focusedIndex, getItemProps } = useListNavigation({
		items: initialPlaylists,
		scope: "onboarding-playlists",
		enabled: !isSaving && initialPlaylists.length > 0,
		direction: "grid",
		rows: rowCount, // Column-major grid: down/up = ±1, left/right = ±rows
		getId: (playlist) => playlist.id,
		onSelect: handlePlaylistSelect,
	});

	const handleContinue = async () => {
		setIsSaving(true);
		try {
			await savePlaylistDestinations({
				data: { playlistIds: Array.from(selectedIds) },
			});
			await goToStep("ready", { syncStats });
		} catch (error) {
			console.error("Failed to save playlist destinations:", error);
			toast.error("Failed to save playlist selections. Please try again.");
			setIsSaving(false);
		}
	};

	const handleSkip = async () => {
		setIsSaving(true);
		try {
			// Skip: save empty selection so user can configure later
			await savePlaylistDestinations({ data: { playlistIds: [] } });
			await goToStep("ready", { syncStats });
		} catch (error) {
			console.error("Failed to skip playlists:", error);
			toast.error("Failed to skip playlists. Please try again.");
			setIsSaving(false);
		}
	};

	const kbdVars = {
		"--kbd-text-color": theme.textMuted,
		"--kbd-bg-color": `${theme.text}10`,
		"--kbd-border-color": `${theme.textMuted}30`,
	} as React.CSSProperties;

	useShortcut({
		key: "enter",
		handler: handleContinue,
		description: "Continue",
		scope: "onboarding-playlists",
		enabled: !isSaving && selectedIds.size > 0,
	});

	return (
		<section ref={sectionRef} aria-label="Playlist selection">
			<div ref={pinnedWrapperRef} className="flex h-dvh flex-col">
				<header className="shrink-0 px-6 pt-12 pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] md:px-12 md:pl-[max(3rem,env(safe-area-inset-left))] md:pr-[max(3rem,env(safe-area-inset-right))]">
					<p
						className="text-xs uppercase tracking-widest"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						Step 02
					</p>

					<h2
						className="mt-2 text-4xl font-extralight leading-tight md:text-6xl"
						style={{ fontFamily: fonts.display, color: theme.text }}
					>
						Pick their <em className="font-normal">homes</em>
					</h2>

					<p
						className="mt-4 text-lg font-light md:text-xl"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						Your liked songs will find their way to these playlists.
					</p>

					<p className="sr-only">
						Scroll down to browse playlists horizontally. Select playlists to
						mark them as destinations.
					</p>
				</header>

				<div ref={viewportRef} className="mt-8 flex-1 overflow-hidden">
					<div ref={trackRef} className="flex h-full items-center">
						<div
							className="grid h-full auto-cols-[min(200px,40vw)] content-center gap-4 py-1 pl-[max(1.5rem,env(safe-area-inset-left))] md:pl-[max(3rem,env(safe-area-inset-left))]"
							style={{
								gridAutoFlow: "column",
								gridTemplateRows: `repeat(${rowCount}, minmax(0, 1fr))`,
							}}
						>
							{initialPlaylists.map((playlist, index) => {
								const isSelected = selectedIds.has(playlist.id);
								const isFocused = focusedIndex === index;
								const itemProps = getItemProps(playlist, index);

								return (
									<button
										key={playlist.id}
										type="button"
										ref={itemProps.ref}
										tabIndex={itemProps.tabIndex}
										data-focused={itemProps["data-focused"]}
										data-playlist-id={playlist.id}
										onClick={handlePlaylistClick}
										aria-pressed={isSelected}
										aria-label={`${isSelected ? "Deselect" : "Select"} playlist ${playlist.name}`}
										title={playlist.name}
										className="group relative h-fit min-h-11 min-w-11 rounded-[2px] outline-none ring-offset-2 focus-visible:ring-2"
										style={{
											["--tw-ring-color" as string]: theme.text,
											["--tw-ring-offset-color" as string]: theme.bg,
											...(isFocused && {
												outline: `2px dashed ${theme.textMuted}`,
												outlineOffset: "2px",
											}),
										}}
									>
										<div className="relative">
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
													src={playlist.imageUrl}
													alt={playlist.name}
													theme={theme}
												/>
											</div>
											{/* Spine text: 8% inset avoids CD case hinge ridges (top ends ~6.4%, bottom starts ~92.7%) */}
											<div
												className="absolute flex items-center justify-center overflow-hidden"
												style={{
													top: "8%",
													bottom: "8%",
													left: 0,
													width: "12.67%",
												}}
											>
												<p
													className="overflow-hidden text-ellipsis whitespace-nowrap text-xs font-light uppercase tracking-wider"
													style={{
														fontFamily: fonts.body,
														color: theme.text,
														writingMode: "vertical-rl",
														transform: "rotate(180deg)",
														maxHeight: "100%",
													}}
												>
													{playlist.name}
												</p>
											</div>
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
						disabled={isSaving || selectedIds.size === 0}
						className="group inline-flex min-h-11 items-center gap-3 rounded outline-2 outline-offset-2 outline-transparent focus-visible:outline-(--focus-color)"
						style={{
							["--focus-color" as string]: theme.text,
							fontFamily: fonts.body,
							color: theme.text,
							opacity: isSaving || selectedIds.size === 0 ? 0.5 : 1,
						}}
					>
						<span className="text-lg font-medium tracking-wide">
							{isSaving
								? "Saving..."
								: `Continue with ${selectedIds.size} playlists`}
						</span>
						<span
							className="inline-block transition-transform group-hover:translate-x-1"
							style={{ color: theme.textMuted }}
						>
							→
						</span>
					</button>

					<button
						type="button"
						onClick={() =>
							setSelectedIds(new Set(initialPlaylists.map((p) => p.id)))
						}
						disabled={isSaving || selectedIds.size === initialPlaylists.length}
						className="min-h-11 rounded text-sm underline outline-2 outline-offset-2 outline-transparent focus-visible:outline-(--focus-color)"
						style={{
							["--focus-color" as string]: theme.text,
							fontFamily: fonts.body,
							color: theme.textMuted,
							opacity:
								isSaving || selectedIds.size === initialPlaylists.length
									? 0.5
									: 1,
						}}
					>
						Select all
					</button>

					<button
						type="button"
						onClick={handleSkip}
						disabled={isSaving}
						className="min-h-11 rounded text-sm underline outline-2 outline-offset-2 outline-transparent focus-visible:outline-(--focus-color)"
						style={{
							["--focus-color" as string]: theme.text,
							fontFamily: fonts.body,
							color: theme.textMuted,
							opacity: isSaving ? 0.5 : 1,
						}}
					>
						Skip for now
					</button>

					<div
						className="ml-auto flex items-center gap-6"
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
							<span className="text-xs">toggle</span>
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
