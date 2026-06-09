/**
 * Flag Playlists step - select target playlists.
 * Full-bleed layout with horizontal-scrolling playlist grid.
 *
 * Uses scroll-jacking: vertical scroll → horizontal playlist movement.
 * Playlists stack in max 3 rows, extending horizontally in columns.
 */

import { ArrowRightIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useListNavigation } from "@/lib/keyboard/useListNavigation";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import {
	type OnboardingPlaylist,
	savePlaylistTargets,
} from "@/lib/server/onboarding.functions";
import { fonts } from "@/lib/theme/fonts";
import { useFlagPlaylistsScroll } from "../hooks/useFlagPlaylistsScroll";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";
import { OnboardingDescriptionDialog } from "./OnboardingDescriptionDialog";

const DESCRIPTION_DIALOG_SEEN_KEY =
	"hearted:has-seen-onboarding-description-dialog";

// Per-user lifetime flag. Recoverable via the (!) icon in /playlists right
// after onboarding, so we don't need server-side persistence here.
function hasSeenDescriptionDialog(): boolean {
	if (typeof window === "undefined") return true;
	try {
		return window.localStorage.getItem(DESCRIPTION_DIALOG_SEEN_KEY) === "1";
	} catch {
		return true;
	}
}

function markDescriptionDialogSeen(): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(DESCRIPTION_DIALOG_SEEN_KEY, "1");
	} catch {
		// Storage unavailable (private mode, quota) — silently no-op. The dialog
		// will re-fire next session, which is acceptable for an edge case.
	}
}

interface FlagPlaylistsStepProps {
	playlists: OnboardingPlaylist[];
}

export function FlagPlaylistsStep({
	playlists: initialPlaylists,
}: FlagPlaylistsStepProps) {
	const { goToStep } = useOnboardingNavigation();
	const [selectedIds, setSelectedIds] = useState<Set<string>>(
		() => new Set(initialPlaylists.filter((p) => p.isTarget).map((p) => p.id)),
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

	// The "should open dialog" decision is computed from current state BEFORE
	// the setter runs — keeping side effects out of the reducer avoids
	// double-invocation footguns under React strict mode and makes the
	// trigger semantics independent of state-update batching.
	const togglePlaylist = useCallback(
		(playlist: OnboardingPlaylist) => {
			const wasSelected = selectedIds.has(playlist.id);
			const wasEmpty = selectedIds.size === 0;

			setSelectedIds((prev) => {
				const next = new Set(prev);
				if (next.has(playlist.id)) {
					next.delete(playlist.id);
				} else {
					next.add(playlist.id);
				}
				return next;
			});

			// Teach on every 0→1 transition within the step. The lifetime "seen"
			// flag (set on Continue/Skip) gates re-entries, not in-step retries.
			if (!wasSelected && wasEmpty && !hasSeenDescriptionDialog()) {
				setDescriptionDialogPlaylist(playlist);
			}
		},
		[selectedIds],
	);

	// Space toggles selection; Enter continues (separation enables keyboard-only flow)
	const handlePlaylistSelect = useCallback(
		(playlist: OnboardingPlaylist) => {
			togglePlaylist(playlist);
		},
		[togglePlaylist],
	);

	// Single click handler for all playlist buttons (avoids creating closures in loop)
	const handlePlaylistClick = useCallback(
		(e: React.MouseEvent<HTMLButtonElement>) => {
			const id = e.currentTarget.dataset.playlistId;
			if (!id) return;
			const playlist = initialPlaylists.find((p) => p.id === id);
			if (playlist) togglePlaylist(playlist);
		},
		[togglePlaylist, initialPlaylists],
	);

	// Dismiss only closes the dialog; the lifetime "seen" flag is set when the
	// user leaves the step (Continue / Skip). This lets the dialog re-fire on
	// later 0→1 transitions within the same onboarding session — e.g. if the
	// user deselects everything and starts over.
	const closeDescriptionDialog = useCallback(() => {
		setDescriptionDialogPlaylist(null);
	}, []);

	const { getItemProps } = useListNavigation({
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
			await savePlaylistTargets({
				data: { playlistIds: Array.from(selectedIds) },
			});
			markDescriptionDialogSeen();
		} catch (error) {
			console.error("Failed to save playlist targets:", error);
			toast.error("Failed to save playlist selections. Please try again.");
			setIsSaving(false);
			return;
		}
		const result = await goToStep("pick-demo-song");
		if (result.status === "transition_failed") {
			setIsSaving(false);
			toast.error(
				"Your playlist preferences were saved, but we couldn't continue. Please try again.",
			);
		}
	};

	const handleSkip = async () => {
		setIsSaving(true);
		try {
			// Skip: save empty selection so user can configure later
			await savePlaylistTargets({ data: { playlistIds: [] } });
			markDescriptionDialogSeen();
		} catch (error) {
			console.error("Failed to skip playlists:", error);
			toast.error("Failed to skip playlists. Please try again.");
			setIsSaving(false);
			return;
		}
		const result = await goToStep("pick-demo-song");
		if (result.status === "transition_failed") {
			setIsSaving(false);
			toast.error(
				"Your playlist preferences were saved, but we couldn't continue. Please try again.",
			);
		}
	};

	useShortcut({
		key: "enter",
		handler: handleContinue,
		description: "Continue",
		scope: "onboarding-playlists",
		// While the teaching dialog is open, Enter should belong to the modal's
		// focused control (textarea newline / button activation), not advance the
		// underlying onboarding step.
		enabled:
			!isSaving && selectedIds.size > 0 && descriptionDialogPlaylist === null,
	});

	return (
		<section ref={sectionRef} aria-label="Playlist selection">
			<div ref={pinnedWrapperRef} className="flex h-dvh flex-col">
				<header className="shrink-0 px-6 pt-12 pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] md:px-12 md:pl-[max(3rem,env(safe-area-inset-left))] md:pr-[max(3rem,env(safe-area-inset-right))]">
					<h2
						className="theme-text text-4xl font-extralight leading-tight md:text-6xl"
						style={{ fontFamily: fonts.display }}
					>
						Pick their <em className="font-normal">homes</em>
					</h2>

					<p
						className="theme-text-muted mt-4 text-lg font-light md:text-xl"
						style={{ fontFamily: fonts.body }}
					>
						Your liked songs will find their way to these playlists.
					</p>

					<p className="sr-only">
						Scroll down to browse playlists horizontally. Select playlists to
						mark them as targets.
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
								const isSelected = selectedIds.has(playlist.id);
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
										aria-label={`${isSelected ? "Deselect" : "Select"} playlist ${playlist.name}`}
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
						onClick={handleContinue}
						disabled={isSaving || selectedIds.size === 0}
						style={{ fontFamily: fonts.body }}
					>
						<span className="text-lg font-medium tracking-wide tabular-nums">
							{isSaving ? (
								"Saving..."
							) : (
								<>
									Continue with{" "}
									<span
										className="inline-block text-center"
										style={{ minWidth: "2ch" }}
									>
										{selectedIds.size}
									</span>{" "}
									playlists
								</>
							)}
						</span>
						<ArrowRightIcon
							size={16}
							className="theme-text-muted inline-block transition-transform group-hover:translate-x-1"
						/>
					</Button>

					<Button
						variant="link"
						size="sm"
						onClick={() =>
							setSelectedIds(new Set(initialPlaylists.map((p) => p.id)))
						}
						disabled={isSaving || selectedIds.size === initialPlaylists.length}
						className="theme-text-muted min-h-11 text-sm underline"
						style={{ fontFamily: fonts.body }}
					>
						Select all
					</Button>

					<Button
						variant="link"
						size="sm"
						onClick={handleSkip}
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
							<span className="text-xs">toggle</span>
						</div>
						<div className="flex items-center gap-1.5">
							<Kbd>⏎</Kbd>
							<span className="text-xs">continue</span>
						</div>
					</div>
				</footer>
			</div>
			{descriptionDialogPlaylist && (
				<OnboardingDescriptionDialog
					playlist={descriptionDialogPlaylist}
					onClose={closeDescriptionDialog}
				/>
			)}
		</section>
	);
}
