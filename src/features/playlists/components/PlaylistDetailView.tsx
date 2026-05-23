import { XIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { type CSSProperties, useCallback, useState } from "react";
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
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
import { PlaylistVoices } from "./PlaylistVoices";

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
	// When null, the panel renders as an absolute in-column layout
	// (SSR-friendly, used for deep links) so the first paint shows the
	// detail without waiting for client-side measurement. When set, the
	// panel renders as a fixed overlay animating from the clicked card's
	// geometry to expandedRect.
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

	const themeVariables: ThemeCssVariables = {
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

	const sharedStyle: CSSProperties & ThemeCssVariables = {
		background: "var(--t-bg)",
		opacity: isExpanded ? 1 : 0,
		pointerEvents: isExpanded ? "auto" : "none",
		...themeVariables,
	};

	// Title scales down in three tiers so a 6-char name still feels hero-sized
	// while a 200-char Spotify auto-generated name doesn't blow past the cover.
	// The 2-line clamp on the <h2> caps the worst case; this just keeps each
	// tier visually balanced inside that clamp. font-extralight reads fine at
	// 48px but loses presence at 30px, so the smaller tiers bump to font-light.
	const nameLength = playlist.name.length;
	const titleSizeClass =
		nameLength <= 24 ? "text-5xl" : nameLength <= 60 ? "text-4xl" : "text-3xl";
	const titleWeightClass = nameLength <= 24 ? "font-extralight" : "font-light";

	// Deep-link arrivals have no source rect to morph from and no DOM to
	// measure on the server, so the panel lays itself out in-column with
	// `position: absolute; inset: 0` — fully CSS-driven, paintable from
	// SSR HTML on the first frame. Card-click arrivals carry a startRect
	// and animate from there using measured fixed-overlay geometry.
	const panelStyle: CSSProperties & ThemeCssVariables =
		startRect === null
			? {
					...sharedStyle,
					position: "absolute",
					inset: 0,
					transition: "opacity 160ms var(--ease-out-expo)",
					willChange: "opacity",
				}
			: {
					...sharedStyle,
					position: "fixed",
					top: expandedRect.top,
					left: expandedRect.left,
					width: expandedRect.width,
					height: expandedRect.height,
					transformOrigin: "top center",
					transform: isExpanded
						? "translateY(0) scale(1)"
						: `translateY(${Math.round((startRect.top - expandedRect.top) * 0.25)}px) scale(0.98)`,
					transition: isExpanded
						? "transform 280ms var(--ease-out-expo), opacity 220ms var(--ease-out-expo)"
						: "transform 220ms var(--ease-out-expo), opacity 160ms var(--ease-out-expo)",
					willChange: "transform, opacity",
				};

	return (
		<div
			data-playlist-panel
			className="z-50 overflow-hidden"
			style={panelStyle}
		>
			<div className="h-full overflow-y-auto px-6 py-8">
				<div className="relative mb-10">
					<button
						type="button"
						onClick={onClose}
						className="theme-text-muted absolute top-0 right-0 z-20 inline-flex size-11 cursor-pointer items-center justify-center transition-[opacity,transform,color] duration-150 hover:text-(--t-text) active:scale-[0.96]"
						style={{
							opacity: isExpanded ? 1 : 0,
							transition: "opacity 200ms var(--ease-out-expo) 80ms",
						}}
						aria-label="Close detail view"
					>
						<XIcon size={20} weight="regular" />
					</button>

					{/* Grid with the cover spanning both rows and `grid-rows-[1fr_auto]`
					   pins the action row to the cover's bottom edge by structure: row 1
					   absorbs any vertical slack, row 2 is sized to the button and lives
					   at the bottom of the grid track — which is the bottom of the cover.
					   Robust to root font-size / zoom changes that would break min-height
					   matching. */}
					<div className="grid grid-cols-[14rem_1fr] grid-rows-[1fr_auto] gap-x-8 gap-y-2">
						{isExpanded && (
							<div
								className="image-outline row-span-2 size-56 self-start overflow-hidden shadow-xl"
								style={{
									viewTransitionName: "playlist-cover",
								}}
							>
								{playlist.image_url ? (
									<img
										src={playlist.image_url}
										alt=""
										className="h-full w-full object-cover"
									/>
								) : (
									<AlbumPlaceholder />
								)}
							</div>
						)}

						<div className="flex min-w-0 flex-col">
							{isExpanded && (
								<h2
									className={`theme-text mb-4 line-clamp-2 leading-[0.95] tracking-tight text-balance ${titleSizeClass} ${titleWeightClass}`}
									style={{
										fontFamily: fonts.display,
										viewTransitionName: "playlist-title",
									}}
									title={playlist.name.length > 30 ? playlist.name : undefined}
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

							{isExpanded && (
								<div
									className="max-w-lg"
									style={{
										opacity: 1,
										transition: "opacity 200ms var(--ease-out-expo) 100ms",
									}}
								>
									<PlaylistVoices playlist={playlist} />
								</div>
							)}
						</div>

						{/* Row 2, col 2: self-end pins to the bottom of the row, which is
						   pinned to the bottom of the cover by the grid's 1fr/auto rows.
						   Hidden during description editing — Save/Cancel are the only
						   verbs that should be live in that mode. */}
						{!isEditingDescription && (
							<div
								className="flex min-w-0 flex-wrap items-center gap-3 self-end"
								style={{
									opacity: isExpanded ? 1 : 0,
									transition: "opacity 200ms var(--ease-out-expo) 120ms",
								}}
							>
								<button
									type="button"
									onClick={() => onToggleTarget(playlist.id, !isTarget)}
									className="theme-target-toggle inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 px-5 text-xs tracking-widest uppercase transition-[background-color,color,transform] duration-150 active:scale-[0.98]"
									data-selected={isTarget}
									style={{ fontFamily: fonts.body }}
									aria-pressed={isTarget}
								>
									<span aria-hidden="true" className="text-base leading-none">
										{isTarget ? "✓" : "+"}
									</span>
									{isTarget ? "In Matching" : "Add to Matching"}
								</button>

								{extensionStatus === "unavailable" && isExpanded && (
									<span
										className="theme-text-muted text-xs italic"
										style={{ fontFamily: fonts.body }}
									>
										Extension required for edits
									</span>
								)}
							</div>
						)}
					</div>
				</div>

				<PlaylistTrackList
					playlistId={isExpanded ? playlist.id : null}
					isExpanded={isExpanded}
					totalTrackCount={playlist.song_count ?? null}
				/>
			</div>
		</div>
	);
}
