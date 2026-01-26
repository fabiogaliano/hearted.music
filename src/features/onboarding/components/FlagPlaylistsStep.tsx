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
import { fonts } from "@/lib/theme/fonts";
import { type ThemeConfig } from "@/lib/theme/types";
import {
	savePlaylistDestinations,
	type OnboardingPlaylist,
} from "@/lib/server/onboarding.server";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";
import { useFlagPlaylistsScroll } from "../hooks/useFlagPlaylistsScroll";
import { CDCaseTuner, type CDCaseConfig } from "@/lib/dev/CDCaseTuner";
import "../types"; // Ensure HistoryState augmentation is loaded

// CD case positioning (tune with CDCaseTuner, press T)
const DEFAULT_CD_CONFIG: CDCaseConfig = { top: 1, right: 1, bottom: 1, left: 10 };

interface FlagPlaylistsStepProps {
	theme: ThemeConfig;
	playlists: OnboardingPlaylist[];
}

export function FlagPlaylistsStep({
	theme,
	playlists: initialPlaylists,
}: FlagPlaylistsStepProps) {
	const { goToStep } = useOnboardingNavigation();
	const location = useLocation();
	// FALLBACK PATTERN: Use navigation state if available, otherwise fallback to zeros
	// Navigation state is lost on page refresh - this prevents crash
	const syncStats = location.state?.syncStats ?? { songs: 0, playlists: 0 };
	const [selectedIds, setSelectedIds] = useState<Set<string>>(
		new Set(initialPlaylists.filter((p) => p.isDestination).map((p) => p.id)),
	);
	const [isSaving, setIsSaving] = useState(false);

	// CD case positioning (tunable via CDCaseTuner - press T)
	const [cdConfig, setCdConfig] = useState(DEFAULT_CD_CONFIG);
	const handleConfigChange = useCallback((config: CDCaseConfig) => {
		setCdConfig(config);
	}, []);

	// Dynamic row count based on viewport height
	// Uses matchMedia to only react when crossing the 900px threshold
	const [rowCount, setRowCount] = useState(3);

	useEffect(() => {
		const mediaQuery = window.matchMedia("(max-height: 900px)");

		const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
			setRowCount(e.matches ? 2 : 3);
		};

		// Set initial value
		handleChange(mediaQuery);

		// Only fires when crossing the threshold — no debounce needed
		mediaQuery.addEventListener("change", handleChange);
		return () => mediaQuery.removeEventListener("change", handleChange);
	}, []);

	// Refs for horizontal scroll animation
	const sectionRef = useRef<HTMLElement>(null);
	const pinnedWrapperRef = useRef<HTMLDivElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	const trackRef = useRef<HTMLDivElement>(null);

	// Initialize horizontal scroll
	useFlagPlaylistsScroll(
		{ sectionRef, pinnedWrapperRef, viewportRef, trackRef },
		{ isReady: initialPlaylists.length > 0 },
	);

	const togglePlaylist = (id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const handleContinue = async () => {
		setIsSaving(true);
		try {
			// Save playlist selections to server
			await savePlaylistDestinations({
				data: { playlistIds: Array.from(selectedIds) },
			});
			// Navigate to next step
			await goToStep("ready", { syncStats });
		} catch (error) {
			console.error("Failed to save playlist destinations:", error);
			toast.error("Failed to save playlist selections. Please try again.");
		} finally {
			setIsSaving(false);
		}
	};

	const handleSkip = async () => {
		setIsSaving(true);
		try {
			// Save empty array (skip playlists)
			await savePlaylistDestinations({ data: { playlistIds: [] } });
			// Navigate to next step
			await goToStep("ready", { syncStats });
		} catch (error) {
			console.error("Failed to skip playlists:", error);
			toast.error("Failed to skip playlists. Please try again.");
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<section
			ref={sectionRef}
			role="region"
			aria-label="Playlist selection"
		>
			<div
				ref={pinnedWrapperRef}
				className="flex h-[100dvh] flex-col"
			>
				{/* Header - pinned at top */}
				<header className="flex-shrink-0 px-6 pt-12 md:px-12">
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

					{/* Screen reader instruction for scroll behavior */}
					<p className="sr-only">
						Scroll down to browse playlists horizontally. Select playlists to mark them as destinations.
					</p>
				</header>

				{/* Viewport - clips the horizontal track */}
				<div
					ref={viewportRef}
					className="mt-8 flex-1 overflow-hidden"
				>
					{/* Track wrapper - flex container for grid + right spacer */}
					<div
						ref={trackRef}
						className="flex h-full items-center"
					>
						{/* Playlist grid */}
						<div
							className="grid h-full auto-cols-[min(200px,40vw)] content-center gap-4 pl-6 md:pl-12"
							style={{ gridAutoFlow: "column", gridTemplateRows: `repeat(${rowCount}, minmax(0, 1fr))` }}
						>
							{initialPlaylists.map((playlist) => {
								const isSelected = selectedIds.has(playlist.id);
								const imgStyle = {
									top: `${cdConfig.top}%`,
									right: `${cdConfig.right}%`,
									bottom: `${cdConfig.bottom}%`,
									left: `${cdConfig.left}%`,
									width: `${100 - cdConfig.left - cdConfig.right}%`,
									height: `${100 - cdConfig.top - cdConfig.bottom}%`,
								};
								return (
									<button
										key={playlist.id}
										type="button"
										onClick={() => togglePlaylist(playlist.id)}
										aria-pressed={isSelected}
										aria-label={`${isSelected ? "Deselect" : "Select"} playlist ${playlist.name}`}
										title={playlist.name}
										className="group relative overflow-hidden rounded-lg"
									>
										<div className="relative aspect-square overflow-hidden">
											{/* Playlist image - sits behind the CD case */}
											{playlist.imageUrl && (
												<img
													src={playlist.imageUrl}
													alt={playlist.name}
													className="absolute object-cover transition-all duration-300"
													style={{
														...imgStyle,
														filter: isSelected ? "grayscale(0%)" : "grayscale(100%)",
														opacity: isSelected ? 1 : 0.35,
													}}
												/>
											)}
											{/* CD case frame overlay */}
											<img
												src="/img_cd/1.png"
												alt=""
												aria-hidden="true"
												className="pointer-events-none absolute inset-0 h-full w-full"
											/>
											{/* Playlist name - in CD case spine (left clear area) */}
											<div
												className="absolute flex items-center justify-center overflow-hidden py-2"
												style={{
													top: `${cdConfig.top}%`,
													bottom: `${cdConfig.bottom}%`,
													left: 0,
													width: `${cdConfig.left}%`,
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
						{/* Right spacer - outside grid, respects its own width */}
						<div className="h-full w-6 flex-shrink-0 md:w-12" aria-hidden="true" />
					</div>
				</div>

				{/* Footer - pinned at bottom */}
				<footer className="flex flex-shrink-0 gap-4 px-6 pb-12 pt-6 md:px-12">
					<button
						type="button"
						onClick={handleContinue}
						disabled={isSaving || selectedIds.size === 0}
						className="group inline-flex items-center gap-3"
						style={{
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
						onClick={() => setSelectedIds(new Set(initialPlaylists.map((p) => p.id)))}
						disabled={isSaving || selectedIds.size === initialPlaylists.length}
						className="text-sm underline"
						style={{
							fontFamily: fonts.body,
							color: theme.textMuted,
							opacity: isSaving || selectedIds.size === initialPlaylists.length ? 0.5 : 1,
						}}
					>
						Select all
					</button>

					<button
						type="button"
						onClick={handleSkip}
						disabled={isSaving}
						className="text-sm underline"
						style={{
							fontFamily: fonts.body,
							color: theme.textMuted,
							opacity: isSaving ? 0.5 : 1,
						}}
					>
						Skip for now
					</button>
				</footer>
			</div>

			{/* Dev tool for tuning CD case positioning - press T to toggle */}
			{import.meta.env.DEV && (
				<CDCaseTuner
					onChange={handleConfigChange}
					initialConfig={DEFAULT_CD_CONFIG}
				/>
			)}
		</section>
	);
}
