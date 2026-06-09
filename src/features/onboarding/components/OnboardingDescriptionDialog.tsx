import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import { Button } from "@/components/ui/Button";
import {
	DESCRIPTION_EXAMPLES,
	DescriptionTeachingHeadline,
} from "@/features/playlists/components/DescriptionTeachingShared";
import {
	commitPlaylistDescriptionSave,
	preparePlaylistDescriptionSave,
} from "@/lib/extension/playlist-description-save";
import { SpotifyReconnectLink } from "@/lib/extension/SpotifyReconnectLink";
import { useSpotifyReconnectState } from "@/lib/extension/useSpotifyReconnectState";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import type { OnboardingPlaylist } from "@/lib/server/onboarding.functions";
import { fonts } from "@/lib/theme/fonts";

type DescriptionEditState =
	| { kind: "idle" }
	| { kind: "saving" }
	| { kind: "reconnect-required" }
	| { kind: "failed" };

interface OnboardingDescriptionDialogProps {
	playlist: OnboardingPlaylist;
	onClose: () => void;
}

export function OnboardingDescriptionDialog({
	playlist,
	onClose,
}: OnboardingDescriptionDialogProps) {
	const [draft, setDraft] = useState(playlist.description ?? "");
	const [editState, setEditState] = useState<DescriptionEditState>({
		kind: "idle",
	});
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [closing, setClosing] = useState(false);
	const closeTimerRef = useRef<number | null>(null);

	const { reconnectNeeded, setReconnectNeeded } = useSpotifyReconnectState(
		playlist.spotifyId,
	);

	// When the polling hook detects Spotify is reconnected, drop back to idle
	// so the Save button reappears for the user to retry their save.
	useEffect(() => {
		if (editState.kind === "reconnect-required" && !reconnectNeeded) {
			setEditState({ kind: "idle" });
		}
	}, [reconnectNeeded, editState.kind]);

	// Match textarea height to content so the underline sits right under the
	// last line, not at the bottom of a fixed `rows={3}` box.
	const autosize = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = "auto";
		textarea.style.height = `${textarea.scrollHeight}px`;
	}, []);

	useEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.focus();
		const length = textarea.value.length;
		textarea.setSelectionRange(length, length);
		autosize();
	}, [autosize]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: draft drives effect timing — autosize reads the textarea via ref so the dep isn't statically visible
	useEffect(() => {
		autosize();
	}, [draft, autosize]);

	// Route every dismissal through here so the exit animation plays before the
	// dialog unmounts. Reduced-motion users skip straight to close — no point
	// holding an empty frame for an animation they won't see.
	const handleClose = useCallback(() => {
		if (closing) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			onClose();
			return;
		}
		setClosing(true);
		closeTimerRef.current = window.setTimeout(onClose, 160);
	}, [closing, onClose]);

	useEffect(() => {
		return () => {
			if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
		};
	}, []);

	useShortcut({
		key: "escape",
		handler: handleClose,
		description: "Close description dialog",
		scope: "modal",
		category: "actions",
		enabled: editState.kind !== "saving",
	});

	const handleSave = async () => {
		if (editState.kind === "saving") return;
		const next = draft.trim();
		if (next === (playlist.description ?? "")) {
			handleClose();
			return;
		}

		setEditState({ kind: "saving" });
		try {
			const preparation = await preparePlaylistDescriptionSave({
				spotifyId: playlist.spotifyId,
				baselineDescription: playlist.description,
				nextDescription: next,
			});

			// Conflict path: Spotify has a newer description than what we synced. We
			// keep Spotify's version and let the user resolve it later in /playlists,
			// where the full conflict UI lives. Onboarding shouldn't carry that
			// weight.
			if (preparation.status === "conflict") {
				toast.message(
					"Spotify has a newer description for this playlist — we kept that one. You can edit it later in your library.",
				);
				handleClose();
				return;
			}

			if (preparation.status === "reconnect-required") {
				setEditState({ kind: "reconnect-required" });
				setReconnectNeeded(true);
				return;
			}

			if (preparation.status === "extension-required") {
				toast.error(
					"The hearted extension is needed to save descriptions. You can edit later in your library.",
				);
				handleClose();
				return;
			}

			if (preparation.status === "fetch-failed") {
				setEditState({ kind: "failed" });
				return;
			}

			const result = await commitPlaylistDescriptionSave(preparation.commit);
			if (!result.ok) {
				setEditState({ kind: "failed" });
				return;
			}

			toast.success("Description saved.");
			handleClose();
		} catch (error) {
			console.error("Failed to save onboarding description:", error);
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
				onClick={handleClose}
				disabled={saving}
			/>
			<div
				role="dialog"
				aria-labelledby="onboarding-description-title"
				data-state={closing ? "closing" : "open"}
				className="theme-bg theme-border-color dialog-content relative w-full max-w-[700px] overflow-hidden border"
			>
				<div className="grid grid-cols-[220px_1fr]">
					{/* Left rail: the playlist — the only filled surface, so the
					    writing column reads as the place to act. */}
					<div
						className="dialog-section theme-surface-dim-bg theme-border-color flex flex-col gap-5 border-r p-6"
						style={{ animationDelay: "60ms" }}
					>
						<div className="image-outline aspect-square w-full overflow-hidden">
							{playlist.imageUrl ? (
								<img
									src={playlist.imageUrl}
									alt={playlist.name}
									className="h-full w-full object-cover"
								/>
							) : (
								<AlbumPlaceholder />
							)}
						</div>
						<div>
							<h4
								className="theme-text text-2xl leading-tight font-extralight tracking-tight text-balance"
								style={{ fontFamily: fonts.display }}
							>
								{playlist.name}
							</h4>
							<p
								className="theme-text-muted mt-2 text-xs tabular-nums"
								style={{ fontFamily: fonts.body }}
							>
								{playlist.songCount}{" "}
								{playlist.songCount === 1 ? "song" : "songs"}
							</p>
						</div>
					</div>

					{/* Right column: the writing area. */}
					<div className="p-8">
						<div className="dialog-section" style={{ animationDelay: "120ms" }}>
							<DescriptionTeachingHeadline
								id="onboarding-description-title"
								italic={false}
							/>

							<p
								className="theme-text mb-8 text-sm leading-relaxed text-pretty"
								style={{ fontFamily: fonts.body }}
							>
								Describe what this playlist is for — a moment, a feeling, a
								sound, a genre. Your liked songs find their way here by what you
								write.
							</p>
						</div>

						<div className="dialog-section" style={{ animationDelay: "180ms" }}>
							<label
								htmlFor="onboarding-description-input"
								className="theme-text-muted mb-2 block text-[10px] tracking-widest uppercase"
								style={{ fontFamily: fonts.body }}
							>
								Playlist Description
							</label>
							<textarea
								id="onboarding-description-input"
								ref={textareaRef}
								value={draft}
								onChange={(e) => setDraft(e.target.value)}
								placeholder="songs i run to · slow jazz for sunday cooking"
								disabled={saving}
								rows={1}
								className="theme-text theme-border-color w-full resize-none overflow-hidden border-b bg-transparent pb-1.5 text-sm leading-relaxed outline-none transition-colors duration-150 focus:border-(--t-primary) disabled:opacity-60"
								style={{ fontFamily: fonts.body }}
							/>

							{editState.kind === "failed" && (
								<div className="mt-3 flex items-center gap-3">
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
							)}
						</div>

						<div
							className="dialog-section mt-6"
							style={{ animationDelay: "240ms" }}
						>
							<div className="flex flex-wrap gap-2">
								{DESCRIPTION_EXAMPLES.slice(0, 5).map((example) => (
									<button
										key={example}
										type="button"
										onClick={() => setDraft(example)}
										disabled={saving}
										className="theme-border-color theme-text-muted theme-hover-surface cursor-pointer rounded-full border px-3 py-2 text-xs transition-[color,background-color,transform] duration-150 hover:text-(--t-text) active:scale-[0.96] disabled:opacity-50"
										style={{ fontFamily: fonts.body }}
									>
										{example}
									</button>
								))}
							</div>
						</div>

						<div
							className="dialog-section mt-8 flex items-center justify-end gap-3"
							style={{ animationDelay: "300ms" }}
						>
							<Button
								variant="ghost"
								size="sm"
								onClick={handleClose}
								disabled={saving}
								style={{ fontFamily: fonts.body }}
							>
								Skip for now
							</Button>
							{editState.kind === "reconnect-required" ? (
								<SpotifyReconnectLink label="Reconnect Spotify to Save" />
							) : (
								<Button
									size="sm"
									onClick={handleSave}
									disabled={saving}
									style={{ fontFamily: fonts.body }}
								>
									{saving ? "Saving…" : "Save"}
								</Button>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>,
		document.body,
	);
}
