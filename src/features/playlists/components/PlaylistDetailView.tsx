import { useQueryClient } from "@tanstack/react-query";
import { type CSSProperties, useCallback, useState } from "react";
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import { Button } from "@/components/ui/Button";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import { isExtensionInstalled } from "@/lib/extension/detect";
import {
	commitPlaylistDescriptionSave,
	outcomeFromCommittedPlaylistDescriptionSave,
	type PreparedPlaylistDescriptionSave,
	preparePlaylistDescriptionSave,
	syncPreparedPlaylistMetadata,
} from "@/lib/extension/playlist-description-save";
import { SpotifyReconnectLink } from "@/lib/extension/SpotifyReconnectLink";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import type { ExtensionAvailability } from "../hooks/useExtensionStatus";
import { playlistKeys } from "../queries";
import { DescriptionConflictDialog } from "./DescriptionConflictDialog";
import { PlaylistDescription } from "./PlaylistDescription";
import { PlaylistTrackList } from "./PlaylistTrackList";

const EXTENSION_STORE_URL =
	"https://chromewebstore.google.com/detail/everything-you-ever-heart/ohaaafmgbbfohhjhogonolonpjhhfohk";

type ThemeCssVariables = {
	"--t-bg": string;
	"--t-surface": string;
	"--t-surface-dim": string;
	"--t-border": string;
	"--t-text": string;
	"--t-text-muted": string;
	"--t-text-on-primary": string;
	"--t-primary": string;
	"--t-primary-hover": string;
};

interface PlaylistDetailViewProps {
	theme: ThemeConfig;
	playlist: Playlist;
	isTarget: boolean;
	isExpanded: boolean;
	startRect: {
		top: number;
		left: number;
		width: number;
		height: number;
	} | null;
	expandedRect: {
		top: number;
		left: number;
		width: number;
		height: number;
	};
	extensionStatus: ExtensionAvailability;
	accountId: string;
	onClose: () => void;
	onToggleTarget: (id: string, isTarget: boolean) => void;
	onMetadataChanged: () => void;
}

type DescriptionEditState =
	| { kind: "idle" }
	| { kind: "saving" }
	| {
			kind: "confirm-overwrite";
			commit: PreparedPlaylistDescriptionSave;
			latestDescription: string | null;
	  }
	| { kind: "failed" }
	| { kind: "reconnect-required" }
	| { kind: "extension-required" };

export function PlaylistDetailView({
	theme,
	playlist,
	isTarget,
	isExpanded,
	startRect,
	expandedRect,
	extensionStatus,
	accountId,
	onClose,
	onToggleTarget,
	onMetadataChanged,
}: PlaylistDetailViewProps) {
	const queryClient = useQueryClient();
	const [isEditingDescription, setIsEditingDescription] = useState(false);
	const [draftDescription, setDraftDescription] = useState("");
	const [editState, setEditState] = useState<DescriptionEditState>({
		kind: "idle",
	});

	useShortcut({
		key: "escape",
		handler: onClose,
		description: "Close detail view",
		scope: "playlists-detail",
		category: "actions",
		enabled: isExpanded,
	});

	const invalidatePlaylists = useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: playlistKeys.management(accountId),
		});
	}, [accountId, queryClient]);

	const commitDescriptionSave = useCallback(
		async (commit: PreparedPlaylistDescriptionSave) => {
			setEditState({ kind: "saving" });

			const result = await commitPlaylistDescriptionSave(commit);
			if (result.ok) {
				setIsEditingDescription(false);
				setEditState({ kind: "idle" });
				onMetadataChanged();
				invalidatePlaylists();
				return;
			}

			const outcome = outcomeFromCommittedPlaylistDescriptionSave(result);

			if (outcome.status === "reconnect-required") {
				setEditState({ kind: "reconnect-required" });
				return;
			}

			if (outcome.status === "extension-unavailable") {
				const installed = await isExtensionInstalled();
				if (!installed) {
					setEditState({ kind: "extension-required" });
					return;
				}
			}

			setEditState({ kind: "failed" });
		},
		[invalidatePlaylists, onMetadataChanged],
	);

	const handleEditDescription = () => {
		setDraftDescription(playlist.description || "");
		setIsEditingDescription(true);
		setEditState({ kind: "idle" });
	};

	const handleSaveDescription = async () => {
		if (extensionStatus !== "available") return;
		if (draftDescription === (playlist.description ?? "")) {
			setIsEditingDescription(false);
			setEditState({ kind: "idle" });
			return;
		}

		setEditState({ kind: "saving" });
		const preparation = await preparePlaylistDescriptionSave({
			spotifyId: playlist.spotify_id,
			baselineDescription: playlist.description,
			nextDescription: draftDescription,
		});

		if (preparation.status === "ready") {
			await commitDescriptionSave(preparation.commit);
			return;
		}

		if (preparation.status === "conflict") {
			const syncResult = await syncPreparedPlaylistMetadata(preparation.commit);
			if (!syncResult.ok) {
				setEditState({ kind: "failed" });
				return;
			}

			onMetadataChanged();
			invalidatePlaylists();
			setEditState({
				kind: "confirm-overwrite",
				commit: preparation.commit,
				latestDescription: preparation.latestDescription,
			});
			return;
		}

		if (preparation.status === "reconnect-required") {
			setEditState({ kind: "reconnect-required" });
			return;
		}

		if (preparation.status === "extension-required") {
			setEditState({ kind: "extension-required" });
			return;
		}

		setEditState({ kind: "failed" });
	};

	const handleCancelDescription = () => {
		setIsEditingDescription(false);
		setDraftDescription(playlist.description || "");
		setEditState({ kind: "idle" });
	};

	const handleDraftDescriptionChange = (value: string) => {
		setDraftDescription(value);
		if (editState.kind === "confirm-overwrite") {
			setEditState({ kind: "idle" });
		}
	};

	const offsetY = startRect
		? Math.round((startRect.top - expandedRect.top) * 0.25)
		: 0;

	const panelStyle: CSSProperties & ThemeCssVariables = {
		position: "fixed",
		background: "var(--t-bg)",
		top: expandedRect.top,
		left: expandedRect.left,
		width: expandedRect.width,
		height: expandedRect.height,
		transformOrigin: "top center",
		transform: isExpanded
			? "translateY(0) scale(1)"
			: `translateY(${offsetY}px) scale(0.98)`,
		opacity: isExpanded ? 1 : 0,
		transition: isExpanded
			? "transform 280ms var(--ease-out-expo), opacity 220ms var(--ease-out-expo)"
			: "transform 220ms var(--ease-out-expo), opacity 160ms var(--ease-out-expo)",
		willChange: "transform, opacity",
		pointerEvents: isExpanded ? "auto" : "none",
		"--t-bg": theme.bg,
		"--t-surface": theme.surface,
		"--t-surface-dim": theme.surfaceDim,
		"--t-border": theme.border,
		"--t-text": theme.text,
		"--t-text-muted": theme.textMuted,
		"--t-text-on-primary": theme.textOnPrimary,
		"--t-primary": theme.primary,
		"--t-primary-hover": theme.primaryHover,
	};

	return (
		<div
			data-playlist-panel
			className="z-50 overflow-hidden"
			style={panelStyle}
		>
			<div className="h-full overflow-y-auto px-6 py-8">
				<div className="relative mb-8">
					<Button
						variant="icon"
						onClick={onClose}
						className="absolute top-0 right-0 z-20"
						style={{
							opacity: isExpanded ? 1 : 0,
							transition: "opacity 200ms var(--ease-out-expo) 80ms",
						}}
						aria-label="Close detail view"
					>
						<span className="text-2xl leading-none">×</span>
					</Button>

					<div className="flex items-start gap-8 pt-12">
						{isExpanded && (
							<div
								className="size-56 flex-shrink-0 overflow-hidden shadow-xl"
								style={{
									viewTransitionName: "playlist-cover",
								}}
							>
								{playlist.image_url ? (
									<img
										src={playlist.image_url}
										alt={playlist.name}
										className="h-full w-full object-cover"
									/>
								) : (
									<AlbumPlaceholder />
								)}
							</div>
						)}

						<div className="min-w-0 flex-1 pt-24 pb-2">
							{isExpanded && (
								<h2
									className="theme-text mb-3 text-4xl leading-tight font-extralight"
									style={{
										fontFamily: fonts.display,
										viewTransitionName: "playlist-title",
									}}
								>
									{playlist.name}
								</h2>
							)}

							<PlaylistDescription
								description={playlist.description}
								trackCount={playlist.song_count ?? 0}
								isExpanded={isExpanded}
								isEditing={isEditingDescription}
								draftDescription={draftDescription}
								extensionStatus={extensionStatus}
								onEdit={handleEditDescription}
								onSave={handleSaveDescription}
								onCancel={handleCancelDescription}
								onDraftChange={handleDraftDescriptionChange}
							/>

							{editState.kind === "confirm-overwrite" && isExpanded && (
								<DescriptionConflictDialog
									latestDescription={editState.latestDescription}
									draftDescription={draftDescription || null}
									onKeepMine={() => {
										void commitDescriptionSave(editState.commit);
									}}
									onUseSpotifys={() => setEditState({ kind: "idle" })}
								/>
							)}

							{editState.kind === "failed" && isExpanded && (
								<div
									role="alert"
									className="mb-4 flex max-w-lg items-center gap-2"
								>
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

							{editState.kind === "reconnect-required" && isExpanded && (
								<div className="mb-4 flex items-center gap-3">
									<p
										className="theme-primary text-xs"
										style={{ fontFamily: fonts.body }}
									>
										Reconnect to Spotify, then repeat this edit.
									</p>
									<SpotifyReconnectLink />
								</div>
							)}

							{editState.kind === "extension-required" && isExpanded && (
								<div className="mb-4 flex items-center gap-3">
									<p
										className="theme-primary text-xs"
										style={{ fontFamily: fonts.body }}
									>
										The extension is required to edit playlists.
									</p>
									<a
										href={EXTENSION_STORE_URL}
										target="_blank"
										rel="noopener noreferrer"
										className="hover-border-brighten inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs tracking-widest uppercase active:scale-[0.98]"
										style={{ fontFamily: fonts.body }}
									>
										Install extension
										<span className="text-xs" style={{ opacity: 0.45 }}>
											↗
										</span>
									</a>
								</div>
							)}

							<div
								className="flex items-center gap-4"
								style={{
									opacity: isExpanded ? 1 : 0,
									transition: "opacity 200ms var(--ease-out-expo) 120ms",
								}}
							>
								<span
									className="theme-text-muted text-xs tracking-widest uppercase"
									style={{ fontFamily: fonts.body }}
								>
									{playlist.song_count ?? 0} Tracks
								</span>

								{extensionStatus === "unavailable" && isExpanded && (
									<span
										className="theme-text-muted text-xs"
										style={{ fontFamily: fonts.body }}
									>
										Extension required for edits
									</span>
								)}

								<div className="ml-auto">
									<button
										type="button"
										onClick={() => onToggleTarget(playlist.id, !isTarget)}
										className="theme-target-toggle flex min-w-[120px] items-center justify-center gap-1.5 px-4 py-2 text-xs tracking-widest uppercase transition-colors duration-150"
										data-selected={isTarget}
										style={{ fontFamily: fonts.body }}
									>
										<span className="text-sm font-light">
											{isTarget ? "−" : "+"}
										</span>
										Matching
									</button>
								</div>
							</div>
						</div>
					</div>
				</div>

				<PlaylistTrackList
					playlistId={isExpanded ? playlist.id : null}
					isExpanded={isExpanded}
				/>
			</div>
		</div>
	);
}
