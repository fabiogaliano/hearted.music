import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import { isExtensionInstalled } from "@/lib/extension/detect";
import { SpotifyReconnectLink } from "@/lib/extension/SpotifyReconnectLink";
import {
	commitPlaylistDescriptionSave,
	outcomeFromCommittedPlaylistDescriptionSave,
	preparePlaylistDescriptionSave,
	syncPreparedPlaylistMetadata,
	type PreparedPlaylistDescriptionSave,
} from "@/lib/extension/playlist-description-save";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import type { ExtensionAvailability } from "../hooks/useExtensionStatus";
import { playlistKeys } from "../queries";
import { DescriptionConflictDialog } from "./DescriptionConflictDialog";
import { PlaylistDescription } from "./PlaylistDescription";
import { PlaylistTrackList } from "./PlaylistTrackList";

const EXTENSION_STORE_URL =
	"https://chrome.google.com/webstore/detail/hearted-spotify-sync/EXTENSION_ID";

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

	return (
		<div
			data-playlist-panel
			className="z-50 overflow-hidden"
			style={{
				position: "fixed",
				background: theme.bg,
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
					? "transform 280ms cubic-bezier(0.23, 1, 0.32, 1), opacity 220ms cubic-bezier(0.23, 1, 0.32, 1)"
					: "transform 220ms cubic-bezier(0.23, 1, 0.32, 1), opacity 160ms cubic-bezier(0.23, 1, 0.32, 1)",
				willChange: "transform, opacity",
				pointerEvents: isExpanded ? "auto" : "none",
			}}
		>
			<div className="h-full overflow-y-auto px-6 py-8">
				<div className="relative mb-8">
					<button
						type="button"
						onClick={onClose}
						className="absolute top-0 right-0 z-20 p-2"
						style={{
							color: theme.textMuted,
							opacity: isExpanded ? 1 : 0,
							transition: "opacity 200ms cubic-bezier(0.23, 1, 0.32, 1) 80ms",
						}}
						aria-label="Close detail view"
					>
						<span className="text-2xl leading-none">×</span>
					</button>

					<div className="flex items-start gap-8 pt-12">
						{isExpanded && (
							<div
								className="h-56 w-56 flex-shrink-0 overflow-hidden shadow-xl"
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
									className="mb-3 text-4xl leading-tight font-extralight"
									style={{
										fontFamily: fonts.display,
										color: theme.text,
										viewTransitionName: "playlist-title",
									}}
								>
									{playlist.name}
								</h2>
							)}

							<PlaylistDescription
								theme={theme}
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
									theme={theme}
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
										className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
										style={{ background: theme.primary }}
									/>
									<p
										className="text-xs leading-relaxed"
										style={{
											fontFamily: fonts.body,
											color: theme.textMuted,
										}}
									>
										Something went sideways saving that. Try again?
									</p>
								</div>
							)}

							{editState.kind === "reconnect-required" && isExpanded && (
								<div className="mb-4 flex items-center gap-3">
									<p
										className="text-xs"
										style={{
											fontFamily: fonts.body,
											color: theme.primary,
										}}
									>
										Reconnect to Spotify, then repeat this edit.
									</p>
									<SpotifyReconnectLink
										surface={theme.surface}
										border={theme.border}
										text={theme.text}
									/>
								</div>
							)}

							{editState.kind === "extension-required" && isExpanded && (
								<div className="mb-4 flex items-center gap-3">
									<p
										className="text-xs"
										style={{
											fontFamily: fonts.body,
											color: theme.primary,
										}}
									>
										The extension is required to edit playlists.
									</p>
									<a
										href={EXTENSION_STORE_URL}
										target="_blank"
										rel="noopener noreferrer"
										className="inline-flex items-center gap-1.5 rounded-[20px] px-3 py-1 text-xs tracking-widest uppercase transition-all hover:opacity-80 active:scale-[0.98]"
										style={{
											fontFamily: fonts.body,
											background: theme.surface,
											border: `1px solid ${theme.border}`,
											color: theme.text,
										}}
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
									transition:
										"opacity 200ms cubic-bezier(0.23, 1, 0.32, 1) 120ms",
								}}
							>
								<span
									className="text-xs tracking-widest uppercase"
									style={{
										fontFamily: fonts.body,
										color: theme.textMuted,
									}}
								>
									{playlist.song_count ?? 0} Tracks
								</span>

								{extensionStatus === "unavailable" && isExpanded && (
									<span
										className="text-xs"
										style={{
											fontFamily: fonts.body,
											color: theme.textMuted,
										}}
									>
										Extension required for edits
									</span>
								)}

								<div className="ml-auto">
									<button
										type="button"
										onClick={() => onToggleTarget(playlist.id, !isTarget)}
										className="flex min-w-[120px] items-center justify-center gap-1.5 px-4 py-2 text-xs tracking-widest uppercase transition-all"
										style={{
											fontFamily: fonts.body,
											color: isTarget ? theme.textOnPrimary : theme.text,
											background: isTarget ? theme.primary : theme.surface,
										}}
										onMouseEnter={(e) => {
											e.currentTarget.style.background = theme.primary;
											e.currentTarget.style.color = theme.textOnPrimary;
										}}
										onMouseLeave={(e) => {
											e.currentTarget.style.background = isTarget
												? theme.primary
												: theme.surface;
											e.currentTarget.style.color = isTarget
												? theme.textOnPrimary
												: theme.text;
										}}
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
					theme={theme}
					playlistId={isExpanded ? playlist.id : null}
					isExpanded={isExpanded}
				/>
			</div>
		</div>
	);
}
