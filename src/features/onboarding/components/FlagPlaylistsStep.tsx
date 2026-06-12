/**
 * Flag Playlists step - pick a single target playlist.
 * Full-bleed layout with horizontal-scrolling playlist grid.
 *
 * Uses scroll-jacking: vertical scroll → horizontal playlist movement.
 * Playlists stack in max 3 rows, extending horizontally in columns.
 *
 * Single-pick: selecting a playlist opens the teaching dialog, which itself
 * drives advancement — "Continue and save" sets the sole target and moves on,
 * "Skip for now" advances with no target. Dismissing the dialog deselects and
 * commits nothing.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useListNavigation } from "@/lib/keyboard/useListNavigation";
import {
	type OnboardingPlaylist,
	savePlaylistTargets,
} from "@/lib/server/onboarding.functions";
import { fonts } from "@/lib/theme/fonts";
import { useFlagPlaylistsScroll } from "../hooks/useFlagPlaylistsScroll";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";
import { OnboardingDescriptionDialog } from "./OnboardingDescriptionDialog";

interface FlagPlaylistsStepProps {
	playlists: OnboardingPlaylist[];
	accountId: string;
}

export function FlagPlaylistsStep({
	playlists: initialPlaylists,
	accountId,
}: FlagPlaylistsStepProps) {
	const { goToStep } = useOnboardingNavigation();
	// Seed from an existing target if the user is revisiting the step; never
	// auto-open the dialog on mount.
	const [selectedId, setSelectedId] = useState<string | null>(
		() => initialPlaylists.find((p) => p.isTarget)?.id ?? null,
	);
	const [isSaving, setIsSaving] = useState(false);
	const [descriptionDialogPlaylist, setDescriptionDialogPlaylist] =
		useState<OnboardingPlaylist | null>(null);

	const fewPlaylists = initialPlaylists.length < 16;

	const [rowCount, setRowCount] = useState(() => (fewPlaylists ? 2 : 3));

	useEffect(() => {
		if (fewPlaylists) {
			setRowCount(2);
			return;
		}
		const mediaQuery = window.matchMedia("(max-height: 900px)");
		setRowCount(mediaQuery.matches ? 2 : 3);
		const handleChange = (e: MediaQueryListEvent) => {
			setRowCount(e.matches ? 2 : 3);
		};
		mediaQuery.addEventListener("change", handleChange);
		return () => mediaQuery.removeEventListener("change", handleChange);
	}, [fewPlaylists]);

	const sectionRef = useRef<HTMLElement>(null);
	const pinnedWrapperRef = useRef<HTMLDivElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	const trackRef = useRef<HTMLDivElement>(null);

	useFlagPlaylistsScroll(
		{ sectionRef, pinnedWrapperRef, viewportRef, trackRef },
		{ isReady: initialPlaylists.length > 0 },
	);

	// Select-and-open: picking a playlist (click or keyboard) sets it as the
	// single selection and opens the teaching dialog every time. Re-selecting the
	// already-picked playlist reopens the dialog rather than deselecting — the
	// dialog is the only path that commits or clears a pick.
	const selectPlaylist = useCallback((playlist: OnboardingPlaylist) => {
		setSelectedId(playlist.id);
		setDescriptionDialogPlaylist(playlist);
	}, []);

	// Single click handler for all playlist buttons (avoids creating closures in loop)
	const handlePlaylistClick = useCallback(
		(e: React.MouseEvent<HTMLButtonElement>) => {
			const id = e.currentTarget.dataset.playlistId;
			if (!id) return;
			const playlist = initialPlaylists.find((p) => p.id === id);
			if (playlist) selectPlaylist(playlist);
		},
		[selectPlaylist, initialPlaylists],
	);

	const { getItemProps } = useListNavigation({
		items: initialPlaylists,
		scope: "onboarding-playlists",
		enabled: !isSaving && initialPlaylists.length > 0,
		direction: "grid",
		rows: rowCount, // Column-major grid: down/up = ±1, left/right = ±rows
		getId: (playlist) => playlist.id,
		onSelect: selectPlaylist,
	});

	// X / backdrop / Esc: deselect and close, committing nothing.
	const closeDialog = useCallback(() => {
		setDescriptionDialogPlaylist(null);
		setSelectedId(null);
	}, []);

	// Core advance legs shared by the dialog (throwing contract) — they save
	// targets and navigate, rejecting on a failed transition so the dialog can
	// hold itself open and surface the failure.
	const skipStep = useCallback(async () => {
		await savePlaylistTargets({ data: { playlistIds: [] } });
		const result = await goToStep("pick-demo-song");
		if (result.status === "transition_failed") {
			throw new Error("Failed to advance after skipping playlists");
		}
	}, [goToStep]);

	const commitAndContinue = useCallback(async () => {
		// Invariant: the dialog only mounts when a playlist has been selected; a
		// silent return here would leave the dialog stranded in its "Saving…" state
		// with no way out. Throw so the dialog's catch surfaces the failure loudly.
		if (!selectedId) {
			throw new Error("commitAndContinue called with no selection");
		}
		await savePlaylistTargets({ data: { playlistIds: [selectedId] } });
		const result = await goToStep("pick-demo-song");
		if (result.status === "transition_failed") {
			throw new Error("Failed to advance after saving playlist");
		}
	}, [goToStep, selectedId]);

	// Footer "Skip for now": same skip, but self-contained error handling since
	// there's no dialog open to surface a failure.
	const handleFooterSkip = async () => {
		setIsSaving(true);
		try {
			await skipStep();
		} catch (error) {
			console.error("Failed to skip playlists:", error);
			toast.error("Failed to skip playlists. Please try again.");
			setIsSaving(false);
		}
	};

	return (
		<section ref={sectionRef} aria-label="Playlist selection">
			<div ref={pinnedWrapperRef} className="flex h-dvh flex-col">
				<header className="shrink-0 px-6 pt-12 pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] md:px-12 md:pl-[max(3rem,env(safe-area-inset-left))] md:pr-[max(3rem,env(safe-area-inset-right))]">
					<h2
						className="theme-text text-4xl font-extralight leading-tight md:text-6xl"
						style={{ fontFamily: fonts.display }}
					>
						Pick its <em className="font-normal">home</em>
					</h2>

					<p
						className="theme-text-muted mt-4 text-lg font-light md:text-xl"
						style={{ fontFamily: fonts.body }}
					>
						Your liked songs will find their way to this playlist.
					</p>

					<p className="sr-only">
						Scroll down to browse playlists horizontally. Select a playlist to
						mark it as your target.
					</p>
				</header>

				<div ref={viewportRef} className="mt-8 flex-1 overflow-hidden">
					<div ref={trackRef} className="flex h-full items-center">
						<div
							className="playlist-grid grid h-full content-center gap-x-4 gap-y-6 py-1 pl-[max(1.5rem,env(safe-area-inset-left))] md:pl-[max(3rem,env(safe-area-inset-left))]"
							style={{
								gridAutoFlow: "column",
								gridTemplateRows: `repeat(${rowCount}, auto)`,
								// Card width scales with viewport height so playlist names
								// stay visible on short screens. Calibration anchor: at
								// 1280x820 (MacBook Air 13") with 2 rows, chrome occupies
								// ~324px (header + footer + safe-area + grid margins), leaving
								// exactly 200px per card. Below 820px, cards shrink so the
								// name labels below them keep clearing the viewport bottom.
								// Caps at min(200px, 40vw) on tall/wide screens; never below
								// 80px on extremely small ones.
								gridAutoColumns: `max(80px, min(200px, 40vw, calc((100dvh - ${300 + rowCount * 60}px) / ${rowCount})))`,
							}}
						>
							{initialPlaylists.map((playlist, index) => {
								const isSelected = selectedId === playlist.id;
								const itemProps = getItemProps(playlist, index);
								const isFocused = itemProps["data-focused"];

								return (
									<button
										key={playlist.id}
										type="button"
										ref={itemProps.ref}
										tabIndex={itemProps.tabIndex}
										data-focused={itemProps["data-focused"]}
										data-nav-engaged={itemProps["data-nav-engaged"]}
										onPointerDown={itemProps.onPointerDown}
										onFocus={itemProps.onFocus}
										onBlur={itemProps.onBlur}
										data-playlist-id={playlist.id}
										onClick={handlePlaylistClick}
										aria-pressed={isSelected}
										aria-label={`Select playlist ${playlist.name}`}
										title={playlist.name}
										className="group relative h-fit min-h-11 min-w-11 cursor-pointer"
										style={{
											...(isFocused && {
												outline: "1px dashed var(--t-text-muted)",
												outlineOffset: "2px",
											}),
										}}
									>
										<div
											className="aspect-square w-full overflow-hidden transition-[filter,opacity] duration-200"
											style={{
												// Grayscale is a no-op on already-gray placeholders,
												// so skip it there. Opacity stays universal: every
												// unselected card — image or placeholder — fades to
												// the same "off" state for parallel ghosting.
												filter: playlist.imageUrl
													? isSelected
														? "grayscale(0%)"
														: "grayscale(100%)"
													: undefined,
												opacity: isSelected ? 1 : 0.35,
											}}
										>
											{playlist.imageUrl ? (
												<img
													src={playlist.imageUrl}
													alt={playlist.name}
													className="h-full w-full object-cover"
												/>
											) : (
												<div
													className="flex h-full w-full items-center justify-center transition-colors duration-200"
													style={{
														// Soft inversion: selected blends text-muted
														// with surface so the fill lands between theme
														// steps — readable as "on" without competing
														// with album art for attention.
														background: isSelected
															? "color-mix(in srgb, var(--t-text-muted) 50%, var(--t-surface))"
															: "var(--t-surface-dim)",
													}}
													aria-hidden="true"
												>
													<span
														className="select-none text-4xl transition-colors duration-200"
														style={{
															color: isSelected
																? "var(--t-surface)"
																: "var(--t-text-muted)",
														}}
													>
														♫
													</span>
												</div>
											)}
										</div>
										<div className="mt-2 min-w-0 max-w-full">
											<p
												className="theme-text truncate text-sm font-medium"
												style={{
													fontFamily: fonts.body,
													opacity: isSelected ? 1 : 0.6,
												}}
											>
												{playlist.name}
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
						size="sm"
						onClick={handleFooterSkip}
						disabled={isSaving}
						className="theme-text-muted min-h-11 text-sm underline"
						style={{ fontFamily: fonts.body }}
					>
						Skip for now
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
					</div>
				</footer>
			</div>
			{descriptionDialogPlaylist && (
				<OnboardingDescriptionDialog
					key={descriptionDialogPlaylist.id}
					playlist={descriptionDialogPlaylist}
					accountId={accountId}
					onClose={closeDialog}
					onCommitAndContinue={commitAndContinue}
					onSkipStep={skipStep}
				/>
			)}
		</section>
	);
}
