import { ArrowLeftIcon, ArrowRightIcon, XIcon } from "@phosphor-icons/react";
import {
	AnimatePresence,
	motion,
	useIsPresent,
	useReducedMotion,
} from "framer-motion";
import { memo, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { PlaylistMatchRow } from "@/components/ui/PlaylistMatchRow";
import { Cover } from "@/features/playlists/components/Cover";
import { SpotifyReconnectLink } from "@/lib/extension/SpotifyReconnectLink";
import { fonts } from "@/lib/theme/fonts";
import type { Playlist } from "../types";
import { ClientNumberFlow as NumberFlow } from "./ClientNumberFlow";
import { usePlaylistTrackPreview } from "./usePlaylistTrackPreview";

// Mirrors the album art's height cap (SongSection), including the -40px reserve
// for the fixed feedback launcher, so on short viewports the matches column
// collapses in step with the art instead of forcing a tall row that pushes the
// controls below the fold or under the launcher.
const MIN_HEIGHT = "min(clamp(300px, 30vw, 560px), calc(50dvh - 40px))";

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
	onDismiss: () => void | Promise<void>;
	onNext: () => void;
	onPrevious?: () => void;
}

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
	onDismiss,
	onNext,
	onPrevious,
}: MatchesSectionProps) {
	const prefersReducedMotion = useReducedMotion();
	const reconnectAction = reconnectNeeded ? (
		<SpotifyReconnectLink label="Reconnect to Spotify" />
	) : undefined;

	return (
		<div
			className="flex flex-col"
			style={{
				minHeight: MIN_HEIGHT,
			}}
		>
			{/* Below lg the matches stack directly under the song with only the grid
			gap between them; this rule restores the visual break the two-column split
			gives on wider viewports. Hidden at lg, where the columns sit side by side. */}
			<div className="theme-border-color mb-8 border-t lg:hidden" />

			{/* initial={false}: see SongSection — the slide is a song-to-song
			transition, not a mount entrance. The composition-level StaggeredContent
			owns the entrance. */}
			<AnimatePresence mode="wait" initial={false}>
				<AnimatedMatchesPanel
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

					<AnimatePresence>
						{realAvailable && (
							<motion.button
								type="button"
								onClick={onRefresh}
								initial={
									prefersReducedMotion ? false : { opacity: 0, height: 0 }
								}
								animate={{ opacity: 1, height: "auto" }}
								exit={
									prefersReducedMotion
										? {}
										: {
												opacity: 0,
												height: 0,
												transition: {
													duration: 0.15,
													ease: [0.645, 0.045, 0.355, 1],
												},
											}
								}
								transition={{
									duration: 0.25,
									ease: [0.165, 0.84, 0.44, 1],
								}}
								className="theme-surface-bg theme-text mt-3 flex w-full items-center justify-between overflow-hidden px-4 py-2.5"
								style={{ fontFamily: fonts.body }}
							>
								<span className="text-xs">Real matches are ready</span>
								<span className="theme-primary text-xs font-medium tracking-wider uppercase">
									Show
								</span>
							</motion.button>
						)}
					</AnimatePresence>

					<div className="mt-6 flex min-h-0 flex-1 flex-col gap-5">
						{playlists.map((playlist) => (
							<MatchRow
								key={playlist.id}
								playlist={playlist}
								added={addedTo.includes(playlist.id)}
								isDemo={isDemo ?? false}
								reconnectNode={reconnectAction}
								navigationDisabled={navigationDisabled ?? false}
								onAdd={onAdd}
							/>
						))}
					</div>
				</AnimatedMatchesPanel>
			</AnimatePresence>

			<MatchesControls
				disabled={navigationDisabled ?? false}
				isLastItem={isLastItem ?? false}
				matchCount={playlists.length}
				onDismiss={onDismiss}
				onPrevious={onPrevious}
				onNext={onNext}
			/>
		</div>
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
}: MatchRowProps) {
	const { triggerProps, preview } = usePlaylistTrackPreview({
		playlistId: playlist.id,
		songCount: playlist.songCount,
		canLoadTracks: !isDemo,
	});

	return (
		<>
			<PlaylistMatchRow
				playlistId={playlist.id}
				name={playlist.name}
				leadProps={triggerProps}
				media={
					<Cover src={playlist.imageUrl} size={48} className="flex-none" />
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

interface AnimatedMatchesPanelProps {
	prefersReducedMotion: boolean;
	/** Skip the slide and swap immediately — see MatchesSectionProps.suppressTransition. */
	instant?: boolean;
	children: ReactNode;
}

function AnimatedMatchesPanel({
	prefersReducedMotion,
	instant,
	children,
}: AnimatedMatchesPanelProps) {
	// While exiting, this subtree is still mounted but stale; block input so
	// users cannot click "Add" buttons that belong to the previous song.
	const isPresent = useIsPresent();
	const skip = instant || prefersReducedMotion;
	return (
		<motion.div
			className="flex flex-1 flex-col"
			initial={skip ? false : { opacity: 0, x: 20 }}
			animate={{
				opacity: 1,
				x: 0,
				transition: skip
					? { duration: 0 }
					: { duration: 0.25, ease: [0.165, 0.84, 0.44, 1] },
			}}
			exit={
				skip
					? {}
					: {
							opacity: 0,
							x: -20,
							transition: {
								duration: 0.18,
								ease: [0.645, 0.045, 0.355, 1],
							},
						}
			}
			style={{ pointerEvents: isPresent ? "auto" : "none" }}
		>
			{children}
		</motion.div>
	);
}

interface MatchesControlsProps {
	disabled: boolean;
	isLastItem: boolean;
	/** Drives the Reject button's singular/plural label. */
	matchCount: number;
	onDismiss: () => void;
	onPrevious?: () => void;
	onNext: () => void;
}

// Lives outside the keyed AnimatePresence subtree so it always renders against
// the latest committed song. Stale DOM from the exiting panel can't intercept
// rapid Next clicks.
function MatchesControls({
	disabled,
	isLastItem,
	matchCount,
	onDismiss,
	onPrevious,
	onNext,
}: MatchesControlsProps) {
	return (
		<div className="mt-8 flex items-center justify-between">
			<Button
				variant="ghost"
				size="sm"
				disabled={disabled}
				onClick={onDismiss}
				style={{ fontFamily: fonts.body }}
			>
				<span className="inline-flex min-h-11 items-center gap-1.5">
					<XIcon size={14} weight="regular" />
					{matchCount === 1 ? "Reject Match" : "Reject Matches"}
				</span>
			</Button>

			<div className="flex items-center gap-6">
				{onPrevious && (
					<Button
						variant="ghost"
						size="sm"
						disabled={disabled}
						onClick={onPrevious}
						style={{ fontFamily: fonts.body }}
					>
						<span className="inline-flex min-h-11 items-center gap-1.5">
							<ArrowLeftIcon size={14} weight="regular" />
							Previous
						</span>
					</Button>
				)}
				<Button
					variant="link"
					disabled={disabled}
					onClick={onNext}
					style={{ fontFamily: fonts.body }}
				>
					<span className="text-base font-medium tracking-wide">
						{isLastItem ? "Finish matching" : "Skip Song"}
					</span>
					<ArrowRightIcon
						size={16}
						weight="regular"
						className="theme-text-muted transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-1"
					/>
				</Button>
			</div>
		</div>
	);
}
