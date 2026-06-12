import { XIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type CSSProperties, useCallback, useState } from "react";
import { toast } from "sonner";
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import {
	savePlaylistGenrePills,
	savePlaylistMatchIntent,
} from "@/lib/server/playlists.functions";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import { accountTopGenresQueryOptions, playlistKeys } from "../queries";
import { PlaylistTrackList } from "./PlaylistTrackList";
import { PlaylistVoices } from "./PlaylistVoices";
import { PlaylistWritingSurface } from "./PlaylistWritingSurface";

// Pills are an ordered, deduped list, so positional comparison is enough to tell
// whether the draft differs from what's saved.
function genresEqual(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((genre, index) => genre === b[index]);
}

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
	accountId: string;
	onClose: () => void;
	onToggleTarget: (id: string, isTarget: boolean) => void;
	onMetadataChanged: () => void;
}

type DescriptionEditState =
	| { kind: "idle" }
	| { kind: "saving" }
	| { kind: "failed" };

export function PlaylistDetailView({
	theme,
	playlist,
	isTarget,
	isExpanded,
	startRect,
	expandedRect,
	accountId,
	onClose,
	onToggleTarget,
	onMetadataChanged,
}: PlaylistDetailViewProps) {
	const queryClient = useQueryClient();
	const [isEditing, setIsEditing] = useState(false);
	const [draftDescription, setDraftDescription] = useState("");
	// Genres commit through the same Save as the intent text (no autosave), so
	// they're held as a draft and a locally-tracked saved set, seeded from the
	// playlist and re-synced to the server's sanitized pills after each save.
	const [draftGenres, setDraftGenres] = useState<string[]>(
		playlist.genre_pills,
	);
	const [savedGenres, setSavedGenres] = useState<string[]>(
		playlist.genre_pills,
	);
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

	// Seeds the genre picker's quick-picks from the account's library genres.
	const { data: topGenres } = useQuery(accountTopGenresQueryOptions(accountId));

	const handleEdit = () => {
		setDraftDescription(playlist.match_intent || "");
		setDraftGenres(savedGenres);
		setIsEditing(true);
		setEditState({ kind: "idle" });
	};

	// One Save commits both halves to our own DB — nothing touches Spotify.
	// Genres are app-local and low-stakes, so they persist first and a genre
	// failure only toasts; the match_intent leg holds the surface open on failure
	// so the user can retry.
	const handleSave = async () => {
		const nextIntent = draftDescription.trim();
		const intentChanged = nextIntent !== (playlist.match_intent ?? "");
		const genresChanged = !genresEqual(draftGenres, savedGenres);

		if (!intentChanged && !genresChanged) {
			setIsEditing(false);
			setEditState({ kind: "idle" });
			return;
		}

		setEditState({ kind: "saving" });

		if (genresChanged) {
			try {
				const result = await savePlaylistGenrePills({
					data: { playlistId: playlist.id, genres: draftGenres },
				});
				setSavedGenres(result.pills);
				setDraftGenres(result.pills);
				invalidatePlaylists();
			} catch (error) {
				console.error("Failed to save genre pills:", error);
				toast.error("Couldn't save genres — try again.");
			}
		}

		if (intentChanged) {
			try {
				await savePlaylistMatchIntent({
					data: {
						playlistId: playlist.id,
						matchIntent: nextIntent.length > 0 ? nextIntent : null,
					},
				});
			} catch (error) {
				console.error("Failed to save match intent:", error);
				setEditState({ kind: "failed" });
				return;
			}
			onMetadataChanged();
		}

		setIsEditing(false);
		setEditState({ kind: "idle" });
		invalidatePlaylists();
	};

	const handleCancel = () => {
		setIsEditing(false);
		setDraftDescription(playlist.match_intent || "");
		setDraftGenres(savedGenres);
		setEditState({ kind: "idle" });
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

							{isExpanded && (
								<div className="mt-2 mb-4 max-w-lg">
									<PlaylistWritingSurface
										description={playlist.match_intent}
										genres={savedGenres}
										isEditing={isEditing}
										draftDescription={draftDescription}
										draftGenres={draftGenres}
										topGenres={topGenres?.genres}
										isSaving={editState.kind === "saving"}
										descriptionViewTransitionName="playlist-description"
										onEditDescription={handleEdit}
										onEditGenres={handleEdit}
										onDraftDescriptionChange={setDraftDescription}
										onDraftGenresChange={setDraftGenres}
										onSave={handleSave}
										onCancel={handleCancel}
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
							)}

							{isExpanded && !isEditing && (
								<div
									className="mt-3 max-w-lg"
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
						   Hidden during editing — Save/Cancel are the only verbs that
						   should be live in that mode. */}
						{!isEditing && (
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
