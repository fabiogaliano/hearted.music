import { AnimatePresence, useReducedMotion } from "framer-motion";
import { memo, type ReactNode } from "react";
import { PlaylistMatchRow } from "@/components/ui/PlaylistMatchRow";
import { Cover } from "@/features/playlists/components/Cover";
import { SpotifyReconnectLink } from "@/lib/extension/SpotifyReconnectLink";
import { fonts } from "@/lib/theme/fonts";
import type { Playlist } from "../types";
import { ClientNumberFlow as NumberFlow } from "./ClientNumberFlow";
import {
	AnimatedReviewPanel,
	RefreshBanner,
	ReviewColumnFrame,
	ReviewControls,
	ReviewEmptyState,
} from "./ReviewColumn";
import { ReviewListScroll } from "./ReviewListScroll";
import { usePlaylistTrackPreview } from "./usePlaylistTrackPreview";

interface MatchesSectionProps {
	songKey: string;
	playlists: Playlist[];
	addedTo: string[];
	isDemo?: boolean;
	realAvailable?: boolean;
	reconnectNeeded?: boolean;
	navigationDisabled?: boolean;
	isLastItem?: boolean;
	/** Swap songs instantly (no slide) while the card-level reject animation runs. */
	suppressTransition?: boolean;
	onRefresh?: () => void;
	onAdd: (playlistId: string) => void;
	onDismissSuggestion?: (playlistId: string) => void | Promise<void>;
	onDismiss: () => void | Promise<void>;
	onNext: () => void;
	onPrevious?: () => void;
}

// Song-mode review column: thin adapter over ReviewColumn's shared
// layout/animation/controls, parameterized with playlist match rows and the
// hover disclosure preview (usePlaylistTrackPreview). See
// docs/architecture/audits/deepening-opportunities-2026-07-02.md for the
// shared/variant split this was extracted from.
export const MatchesSection = memo(function MatchesSection({
	songKey,
	playlists,
	addedTo,
	isDemo,
	realAvailable,
	reconnectNeeded,
	navigationDisabled,
	isLastItem,
	suppressTransition,
	onRefresh,
	onAdd,
	onDismissSuggestion,
	onDismiss,
	onNext,
	onPrevious,
}: MatchesSectionProps) {
	const prefersReducedMotion = useReducedMotion();
	const reconnectAction = reconnectNeeded ? (
		<SpotifyReconnectLink label="Reconnect to Spotify" />
	) : undefined;

	return (
		<ReviewColumnFrame>
			{/* initial={false}: see SongSection — the slide is a song-to-song
			transition, not a mount entrance. The composition-level StaggeredContent
			owns the entrance. */}
			<AnimatePresence mode="wait" initial={false}>
				<AnimatedReviewPanel
					key={songKey}
					prefersReducedMotion={prefersReducedMotion ?? false}
					instant={suppressTransition ?? false}
				>
					<div className="flex items-center gap-2">
						<p
							className="theme-text-muted text-xs tracking-widest uppercase"
							style={{ fontFamily: fonts.body }}
						>
							Best Matches
						</p>
						{isDemo && (
							<span
								className="theme-surface-bg theme-text-muted rounded-full px-2 py-0.5 text-xs tracking-widest uppercase"
								style={{ fontFamily: fonts.body }}
							>
								Demo
							</span>
						)}
					</div>

					<RefreshBanner
						visible={realAvailable ?? false}
						prefersReducedMotion={prefersReducedMotion ?? false}
						onRefresh={onRefresh}
					/>

					<ReviewListScroll>
						{playlists.length === 0 ? (
							<ReviewEmptyState />
						) : (
							playlists.map((playlist) => (
								<MatchRow
									key={playlist.id}
									playlist={playlist}
									added={addedTo.includes(playlist.id)}
									isDemo={isDemo ?? false}
									reconnectNode={reconnectAction}
									navigationDisabled={navigationDisabled ?? false}
									onAdd={onAdd}
									onDismiss={onDismissSuggestion}
								/>
							))
						)}
					</ReviewListScroll>
				</AnimatedReviewPanel>
			</AnimatePresence>

			<ReviewControls
				disabled={navigationDisabled ?? false}
				isLastItem={isLastItem ?? false}
				count={playlists.length}
				nextLabel="Skip Song"
				onDismiss={onDismiss}
				onPrevious={onPrevious}
				onNext={onNext}
			/>
		</ReviewColumnFrame>
	);
});

interface MatchRowProps {
	playlist: Playlist;
	added: boolean;
	isDemo: boolean;
	/** Reconnect CTA shown in place of Add when a Spotify reconnect is needed. */
	reconnectNode?: ReactNode;
	navigationDisabled: boolean;
	onAdd: (playlistId: string) => void;
	onDismiss?: (playlistId: string) => void | Promise<void>;
}

// One match row + its hover preview. A component (not an inline map body) so the
// preview hook is called once per playlist under the rules of hooks. The preview
// trigger spans the cover+name region so hovering either — or crossing the gap
// between them — opens it as one bridge without flicker.
function MatchRow({
	playlist,
	added,
	isDemo,
	reconnectNode,
	navigationDisabled,
	onAdd,
	onDismiss,
}: MatchRowProps) {
	const canLoadTracks = !isDemo;
	const { hoverProps, handleProps, preview } = usePlaylistTrackPreview({
		playlistId: playlist.id,
		songCount: playlist.songCount,
		canLoadTracks,
		name: playlist.name,
		reason: playlist.reason || undefined,
		// The cover is a real disclosure button now: hover opens it on fine
		// pointers, click/tap/Enter pins it. That gives touch and keyboard users
		// the same preview — the old hover-only tooltip left them with no way in.
		interaction: "disclosure",
		label: playlist.name,
	});

	// Merge the pointer bridge with the button handle onto one cover button.
	// hoverProps.style (a default cursor) is intentionally dropped — the cover is
	// clickable now, so PlaylistMatchRow styles it with a pointer cursor instead.
	const coverProps = canLoadTracks
		? {
				onPointerEnter: hoverProps.onPointerEnter,
				onPointerLeave: hoverProps.onPointerLeave,
				...handleProps,
			}
		: undefined;

	return (
		<>
			<PlaylistMatchRow
				playlistId={playlist.id}
				name={playlist.name}
				coverProps={coverProps}
				media={
					<Cover src={playlist.imageUrl} size={56} className="flex-none" />
				}
				scoreDisplay={
					<NumberFlow
						value={Math.round(playlist.matchScore * 100)}
						suffix="%"
						className="theme-text font-extralight tabular-nums leading-none"
						style={{ fontFamily: fonts.display, fontSize: "1.5rem" }}
					/>
				}
				reason={reconnectNode ? undefined : playlist.reason || undefined}
				size="lg"
				onDismiss={onDismiss}
				dismissDisabled={navigationDisabled}
				dismissLabel={`Dismiss playlist suggestion: ${playlist.name}`}
				action={
					added
						? { type: "added" }
						: reconnectNode
							? { type: "custom", node: reconnectNode }
							: { type: "add", disabled: navigationDisabled, onAdd }
				}
			/>
			{preview}
		</>
	);
}
