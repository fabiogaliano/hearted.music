import { XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import { Button } from "@/components/ui/Button";
import { DescriptionExamplesShuffle } from "@/features/playlists/components/explorations/DescriptionExamplesShuffle";
import { PlaylistWritingSurface } from "@/features/playlists/components/PlaylistWritingSurface";
import { accountTopGenresQueryOptions } from "@/features/playlists/queries";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import type { OnboardingPlaylist } from "@/lib/server/onboarding.functions";
import {
	savePlaylistGenrePills,
	savePlaylistMatchIntent,
} from "@/lib/server/playlists.functions";
import { fonts } from "@/lib/theme/fonts";

type DescriptionEditState =
	| { kind: "idle" }
	| { kind: "saving" }
	| { kind: "failed" };

// Pills are an ordered, deduped list, so positional comparison is enough to tell
// whether the draft differs from what's saved.
function genresEqual(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((genre, index) => genre === b[index]);
}

interface OnboardingDescriptionDialogProps {
	playlist: OnboardingPlaylist;
	accountId: string;
	/** X / backdrop / Esc — deselect and dismiss, committing nothing. */
	onClose: () => void;
	/** "Continue and save" — advance the step with this playlist as the sole
	 *  target. Resolves on success; rejects (e.g. transition failed) so the dialog
	 *  can surface a failure and stay open. */
	onCommitAndContinue: () => Promise<void> | void;
	/** "Skip for now" — advance the step with no playlist. Same resolve/reject
	 *  contract as onCommitAndContinue. */
	onSkipStep: () => Promise<void> | void;
}

/**
 * First-pick teaching dialog. Rather than a bespoke teaching layout, it renders a
 * faithful slice of the in-app playlist detail view — cover, title, and the same
 * PlaylistWritingSurface — so the user learns the exact surface they'll use in
 * /playlists. It opens collapsed (display-first) with inspiration examples; the
 * user clicks to edit, then "Continue and save" persists the intent text and
 * genres to our own DB (never Spotify) and advances the onboarding step. Both
 * "Skip for now" and "Continue and save" drive advancement; dismissing commits
 * nothing — a dismissed pick is a non-pick.
 */
export function OnboardingDescriptionDialog({
	playlist,
	accountId,
	onClose,
	onCommitAndContinue,
	onSkipStep,
}: OnboardingDescriptionDialogProps) {
	const [draftDescription, setDraftDescription] = useState(
		playlist.matchIntent ?? "",
	);
	// Genres commit through the same "Continue and save" as the intent text (no
	// autosave): held as a draft and a locally-tracked saved set, re-synced to the
	// server's sanitized pills after a save.
	const [draftGenres, setDraftGenres] = useState<string[]>(playlist.genrePills);
	const [savedGenres, setSavedGenres] = useState<string[]>(playlist.genrePills);
	const [editState, setEditState] = useState<DescriptionEditState>({
		kind: "idle",
	});
	// Display-first, like the in-app detail view: the surface opens collapsed
	// (intent text + a dormant "+ Add genres" pill) and only expands the genre
	// engine once the user opts into editing. Clicking the text or "+ Add genres"
	// enters edit.
	const [isEditing, setIsEditing] = useState(false);
	const [closing, setClosing] = useState(false);
	const closeTimerRef = useRef<number | null>(null);

	const { data: topGenres } = useQuery(accountTopGenresQueryOptions(accountId));

	// Play the exit animation before running `after`. Reduced-motion users skip
	// straight through — no point holding an empty frame for an animation they
	// won't see.
	const runClose = useCallback(
		(after: () => void) => {
			if (closing) return;
			if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
				after();
				return;
			}
			setClosing(true);
			closeTimerRef.current = window.setTimeout(after, 160);
		},
		[closing],
	);

	useEffect(() => {
		return () => {
			if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
		};
	}, []);

	// X / backdrop / Esc discards both genre and text edits and deselects the pick.
	// Nothing is committed until "Continue and save" — a dismissed pick is a
	// non-pick.
	const handleDismiss = useCallback(() => {
		runClose(onClose);
	}, [runClose, onClose]);

	// Enter edit from the collapsed surface; seed the drafts from what's saved so
	// the editor starts from the current state. The surface decides which control
	// to focus (text vs genres) from whichever affordance was clicked.
	const handleEdit = () => {
		setDraftDescription(playlist.matchIntent ?? "");
		setDraftGenres(savedGenres);
		setEditState({ kind: "idle" });
		setIsEditing(true);
	};

	// Back out of an edit to the collapsed display, discarding the draft —
	// matching the detail view's Cancel.
	const handleCancelEdit = () => {
		setDraftDescription(playlist.matchIntent ?? "");
		setDraftGenres(savedGenres);
		setEditState({ kind: "idle" });
		setIsEditing(false);
	};

	// "Pick" on an inspiration example seeds the drafts from it and opens the
	// editor directly — bypassing handleEdit's reset-from-saved, since the point
	// is to start from the example, not the current saved state.
	const handlePickExample = useCallback(
		(description: string, genres: readonly string[]) => {
			setDraftDescription(description);
			setDraftGenres([...genres]);
			setEditState({ kind: "idle" });
			setIsEditing(true);
		},
		[],
	);

	useShortcut({
		key: "escape",
		handler: handleDismiss,
		description: "Close description dialog",
		scope: "modal",
		category: "actions",
		enabled: editState.kind !== "saving",
	});

	// "Skip for now" leaves the playlist-pick step entirely (matches no playlist).
	// Available in both display and edit mode; discards any in-progress edits. The
	// parent owns the advance, so we only reflect failure here.
	const handleSkip = async () => {
		if (editState.kind === "saving") return;
		setEditState({ kind: "saving" });
		try {
			await onSkipStep();
		} catch (error) {
			console.error("Failed to skip playlist step:", error);
			setEditState({ kind: "idle" });
			toast.error("Couldn't skip — try again.");
		}
	};

	// "Continue and save" persists genres + match intent to our own DB (never
	// Spotify), then asks the parent to advance with this playlist as the sole
	// target. Both legs and the advance share one error surface: any failure holds
	// the dialog open in its "failed" state so the user can retry.
	const handleContinueAndSave = async () => {
		if (editState.kind === "saving") return;
		const nextIntent = draftDescription.trim();
		const intentChanged = nextIntent !== (playlist.matchIntent ?? "");
		const genresChanged = !genresEqual(draftGenres, savedGenres);

		setEditState({ kind: "saving" });

		try {
			if (genresChanged) {
				const result = await savePlaylistGenrePills({
					data: { playlistId: playlist.id, genres: draftGenres },
				});
				setSavedGenres(result.pills);
				setDraftGenres(result.pills);
			}
			if (intentChanged) {
				await savePlaylistMatchIntent({
					data: {
						playlistId: playlist.id,
						matchIntent: nextIntent.length > 0 ? nextIntent : null,
					},
				});
			}
			await onCommitAndContinue();
		} catch (error) {
			console.error("Failed to save onboarding pick:", error);
			setEditState({ kind: "failed" });
		}
	};

	const saving = editState.kind === "saving";

	return createPortal(
		<div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
			<button
				type="button"
				aria-label="Close"
				data-state={closing ? "closing" : "open"}
				className="dialog-backdrop absolute inset-0 cursor-default appearance-none border-0 bg-black/50 p-0 backdrop-blur-sm"
				onClick={handleDismiss}
				disabled={saving}
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="onboarding-description-title"
				data-state={closing ? "closing" : "open"}
				className="theme-bg theme-border-color dialog-content relative max-h-[calc(100dvh-2rem)] w-full max-w-[600px] overflow-y-auto rounded-none border p-8"
			>
				<button
					type="button"
					onClick={handleDismiss}
					disabled={saving}
					aria-label="Close"
					className="theme-text-muted absolute top-5 right-5 z-10 inline-flex size-11 cursor-pointer items-center justify-center transition-[color,transform] duration-150 hover:text-(--t-text) active:scale-[0.96] disabled:opacity-50"
				>
					<XIcon size={18} weight="regular" />
				</button>

				{/* Teaching message leads — the dialog fires on the first playlist pick
				    to explain the writing surface, so the words are the hero. The
				    playlist itself drops to a small context row below. */}
				<div className="dialog-section" style={{ animationDelay: "60ms" }}>
					<h2
						id="onboarding-description-title"
						className="theme-text text-3xl leading-[1.1] font-light tracking-tight text-balance"
						style={{ fontFamily: fonts.display }}
					>
						How songs find their way{" "}
						<em style={{ fontStyle: "italic" }}>home</em>
					</h2>
				</div>

				{/* Combined card: the playlist identity (cover + name) and the
				    description writing surface share one container, a softly-darker
				    header zoning off the identity from the description body below. */}
				<div
					className="dialog-section mt-7"
					style={{ animationDelay: "140ms" }}
				>
					<div className="dialog-playlist-card">
						<div className="dialog-playlist-card-head">
							<div className="image-outline size-12 flex-shrink-0 overflow-hidden shadow-sm">
								{playlist.imageUrl ? (
									<img
										src={playlist.imageUrl}
										alt=""
										className="h-full w-full object-cover"
									/>
								) : (
									<AlbumPlaceholder />
								)}
							</div>
							<div className="min-w-0">
								<p
									className="theme-text truncate text-sm font-medium"
									style={{ fontFamily: fonts.body }}
									title={playlist.name.length > 30 ? playlist.name : undefined}
								>
									{playlist.name}
								</p>
								{playlist.songCount != null && (
									<p
										className="theme-text-muted text-xs tabular-nums"
										style={{ fontFamily: fonts.body }}
									>
										{playlist.songCount}{" "}
										{playlist.songCount === 1 ? "song" : "songs"}
									</p>
								)}
							</div>
						</div>
						<PlaylistWritingSurface
							embedded
							description={playlist.matchIntent}
							genres={savedGenres}
							isEditing={isEditing}
							draftDescription={draftDescription}
							draftGenres={draftGenres}
							topGenres={topGenres?.genres}
							isSaving={saving}
							saveLabel="Continue and save"
							onEditDescription={handleEdit}
							onEditGenres={handleEdit}
							onDraftDescriptionChange={setDraftDescription}
							onDraftGenresChange={setDraftGenres}
							onSave={handleContinueAndSave}
							onCancel={handleCancelEdit}
							editFooter={
								editState.kind === "failed" ? (
									<div role="alert" className="flex items-center gap-2">
										<span
											aria-hidden="true"
											className="theme-primary-bg inline-block size-1.5 flex-shrink-0 rounded-full"
										/>
										<p
											className="theme-text-muted text-xs leading-relaxed"
											style={{ fontFamily: fonts.body }}
										>
											Something went sideways saving that. Try again?
										</p>
									</div>
								) : null
							}
						/>
					</div>
				</div>

				{/* Read-only inspiration, display mode only: shows what a good
				    description looks like (and the genres that pair with it) without
				    touching the user's own writing. Hidden in edit mode so the editor
				    stays focused. */}
				{!isEditing && (
					<div
						className="dialog-section mt-5"
						style={{ animationDelay: "260ms" }}
					>
						<DescriptionExamplesShuffle onPick={handlePickExample} />
					</div>
				)}

				{/* Always available, edit or not: "Skip for now" leaves the onboarding
				    step entirely (matches no playlist), distinct from the surface's
				    "Cancel" (which only reverts an in-progress edit). */}
				<div
					className="dialog-section mt-5 flex justify-end"
					style={{ animationDelay: isEditing ? "260ms" : "320ms" }}
				>
					<Button
						variant="ghost"
						size="sm"
						onClick={handleSkip}
						disabled={saving}
						style={{ fontFamily: fonts.body }}
					>
						Skip for now
					</Button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
