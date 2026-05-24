import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import { Button } from "@/components/ui/Button";
import {
	DescriptionExamplesCarousel,
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

	useShortcut({
		key: "escape",
		handler: onClose,
		description: "Close description dialog",
		scope: "modal",
		category: "actions",
		enabled: editState.kind !== "saving",
	});

	const handleSave = async () => {
		if (editState.kind === "saving") return;
		const next = draft.trim();
		if (next === (playlist.description ?? "")) {
			onClose();
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
				onClose();
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
				onClose();
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
			onClose();
		} catch (error) {
			console.error("Failed to save onboarding description:", error);
			setEditState({ kind: "failed" });
		}
	};

	return createPortal(
		<div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
			<button
				type="button"
				aria-label="Close"
				className="dialog-backdrop absolute inset-0 cursor-default appearance-none border-0 bg-black/50 p-0 backdrop-blur-sm"
				onClick={onClose}
				disabled={editState.kind === "saving"}
			/>
			<div
				role="dialog"
				aria-labelledby="onboarding-description-title"
				className="theme-bg theme-border-color dialog-content relative w-full max-w-[540px] border p-8"
			>
				<DescriptionTeachingHeadline id="onboarding-description-title" />

				<p
					className="theme-text mb-6 text-sm leading-relaxed text-pretty"
					style={{ fontFamily: fonts.body }}
				>
					Your words light the way.
				</p>

				<LivePlaylistEditor
					playlist={playlist}
					draft={draft}
					onDraftChange={setDraft}
					textareaRef={textareaRef}
					disabled={editState.kind === "saving"}
				/>

				{editState.kind === "failed" && (
					<div className="my-4 flex items-center gap-3">
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

				<DescriptionExamplesCarousel />

				<div className="flex items-center justify-end gap-3">
					<Button
						variant="ghost"
						size="sm"
						onClick={onClose}
						disabled={editState.kind === "saving"}
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
							disabled={editState.kind === "saving"}
							style={{ fontFamily: fonts.body }}
						>
							{editState.kind === "saving" ? "Saving..." : "Save"}
						</Button>
					)}
				</div>
			</div>
		</div>,
		document.body,
	);
}

// Non-interactive visual context (cover + name) wrapped around the one
// interactive surface (the textarea). Mirrors the layout of DetailViewMirror
// from the /playlists teaching dialog so the visual recognition carries over.
function LivePlaylistEditor({
	playlist,
	draft,
	onDraftChange,
	textareaRef,
	disabled,
}: {
	playlist: OnboardingPlaylist;
	draft: string;
	onDraftChange: (value: string) => void;
	textareaRef: React.RefObject<HTMLTextAreaElement | null>;
	disabled: boolean;
}) {
	return (
		<div className="theme-surface-dim-bg flex items-start gap-5 p-4">
			<div className="image-outline size-24 flex-shrink-0 overflow-hidden">
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

			<div className="min-w-0 flex-1">
				<h4
					className="theme-text mb-2 text-2xl leading-tight font-extralight tracking-tight"
					style={{ fontFamily: fonts.display }}
				>
					{playlist.name}
				</h4>

				<textarea
					ref={textareaRef}
					value={draft}
					onChange={(e) => onDraftChange(e.target.value)}
					placeholder="songs i run to · slow jazz for sunday cooking"
					disabled={disabled}
					rows={1}
					className="theme-text theme-border-color w-full resize-none overflow-hidden border-b bg-transparent pb-1 text-sm leading-relaxed outline-none transition-colors duration-150 focus:border-(--t-primary) disabled:opacity-60"
					style={{ fontFamily: fonts.body }}
				/>
			</div>
		</div>
	);
}
