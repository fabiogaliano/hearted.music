import { ArrowRightIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { memo } from "react";
import { Button } from "@/components/ui/Button";
import { PlaylistMatchRow } from "@/components/ui/PlaylistMatchRow";
import { SpotifyReconnectLink } from "@/lib/extension/SpotifyReconnectLink";
import { fonts } from "@/lib/theme/fonts";
import type { Playlist } from "../types";
import { ClientNumberFlow as NumberFlow } from "./ClientNumberFlow";

const MIN_HEIGHT = "clamp(300px, 30vw, 560px)";

interface MatchesSectionProps {
	songKey: string;
	playlists: Playlist[];
	addedTo: string[];
	isDemo?: boolean;
	realAvailable?: boolean;
	reconnectNeeded?: boolean;
	onRefresh?: () => void;
	onAdd: (playlistId: string) => void;
	onDismiss: () => void;
	onNext: () => void;
}

export const MatchesSection = memo(function MatchesSection({
	songKey,
	playlists,
	addedTo,
	isDemo,
	realAvailable,
	reconnectNeeded,
	onRefresh,
	onAdd,
	onDismiss,
	onNext,
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
			<AnimatePresence mode="wait">
				<motion.div
					key={songKey}
					className="flex flex-1 flex-col"
					initial={prefersReducedMotion ? false : { opacity: 0, x: 20 }}
					animate={{
						opacity: 1,
						x: 0,
						transition: { duration: 0.25, ease: [0.165, 0.84, 0.44, 1] },
					}}
					exit={
						prefersReducedMotion
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
						{playlists.map((playlist) => {
							return (
								<PlaylistMatchRow
									key={playlist.id}
									playlistId={playlist.id}
									name={playlist.name}
									scoreDisplay={
										<NumberFlow
											value={Math.round(playlist.matchScore * 100)}
											suffix="%"
											className="theme-text font-extralight tabular-nums leading-none"
											style={{
												fontFamily: fonts.display,
												fontSize: "1.5rem",
											}}
										/>
									}
									reason={
										reconnectNeeded ? undefined : playlist.reason || undefined
									}
									size="lg"
									action={
										addedTo.includes(playlist.id)
											? { type: "added" }
											: reconnectAction
												? { type: "custom", node: reconnectAction }
												: { type: "add", onAdd }
									}
								/>
							);
						})}
					</div>

					<div className="mt-8 flex items-center justify-between">
						<Button
							variant="ghost"
							size="sm"
							onClick={onDismiss}
							style={{ fontFamily: fonts.body }}
						>
							Dismiss
						</Button>

						<Button
							variant="link"
							onClick={onNext}
							style={{ fontFamily: fonts.body }}
						>
							<span className="text-base font-medium tracking-wide">
								Next Song
							</span>
							<ArrowRightIcon
								size={16}
								weight="regular"
								className="theme-text-muted transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-1"
							/>
						</Button>
					</div>
				</motion.div>
			</AnimatePresence>
		</div>
	);
});
