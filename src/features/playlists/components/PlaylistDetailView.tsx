import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import type { ThemeConfig } from "@/lib/theme/types";
import { fonts } from "@/lib/theme/fonts";
import { updatePlaylistAcknowledged } from "@/lib/extension/playlist-write-acknowledgement";
import type { ExtensionAvailability } from "../hooks/useExtensionStatus";
import { playlistKeys } from "../queries";
import { PlaylistDescription } from "./PlaylistDescription";
import { PlaylistTrackList } from "./PlaylistTrackList";

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
	const [editState, setEditState] = useState<"idle" | "saving" | "failed">(
		"idle",
	);

	useShortcut({
		key: "escape",
		handler: onClose,
		description: "Close detail view",
		scope: "playlists-detail",
		category: "actions",
		enabled: isExpanded,
	});

	if (!startRect) return null;

	const handleEditDescription = () => {
		setDraftDescription(playlist.description || "");
		setIsEditingDescription(true);
		setEditState("idle");
	};

	const handleSaveDescription = async () => {
		if (extensionStatus !== "available") return;

		setEditState("saving");
		const result = await updatePlaylistAcknowledged(playlist.spotify_id, {
			description: draftDescription,
		});

		if (result.ok) {
			setIsEditingDescription(false);
			setEditState("idle");
			onMetadataChanged();
			queryClient.invalidateQueries({
				queryKey: playlistKeys.management(accountId),
			});
		} else {
			setEditState("failed");
		}
	};

	const handleCancelDescription = () => {
		setIsEditingDescription(false);
		setDraftDescription(playlist.description || "");
		setEditState("idle");
	};

	const offsetY = Math.round((startRect.top - expandedRect.top) * 0.25);

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
									<div
										className="flex h-full w-full items-center justify-center"
										style={{
											background: theme.surfaceDim,
										}}
									>
										<span
											className="text-4xl"
											style={{
												color: theme.textMuted,
											}}
										>
											♪
										</span>
									</div>
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
								onDraftChange={setDraftDescription}
							/>

							{editState === "failed" && isExpanded && (
								<p
									className="mb-4 text-xs"
									style={{
										fontFamily: fonts.body,
										color: theme.primary,
									}}
								>
									Description update failed. Please try again.
								</p>
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
