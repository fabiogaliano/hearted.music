import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { memo } from "react";
import { PlaylistMatchRow } from "@/components/ui/PlaylistMatchRow";
import { SpotifyReconnectLink } from "@/lib/extension/SpotifyReconnectLink";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import type { Playlist } from "../types";
import { ClientNumberFlow as NumberFlow } from "./ClientNumberFlow";

const MIN_HEIGHT = "clamp(300px, 30vw, 560px)";

interface MatchesSectionProps {
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
	const theme = useTheme();
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
						initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
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
						transition={{ duration: 0.25, ease: [0.165, 0.84, 0.44, 1] }}
						className="theme-surface-bg theme-text mt-3 flex w-full items-center justify-between overflow-hidden rounded-lg px-4 py-2.5"
						style={{ fontFamily: fonts.body }}
					>
						<span className="text-xs">Real matches are ready</span>
						<span className="theme-primary text-xs font-medium tracking-wider uppercase">
							Show
						</span>
					</motion.button>
				)}
			</AnimatePresence>

			<div
				className="flex min-h-0 flex-1 flex-col"
				style={{
					marginTop: "1.5rem",
					gap: "1.25rem",
				}}
			>
				{playlists.map((playlist) => {
					const isGoodMatch = playlist.matchScore >= 0.7;
					return (
						<PlaylistMatchRow
							key={playlist.id}
							playlistId={playlist.id}
							name={playlist.name}
							scoreDisplay={
								<NumberFlow
									value={Math.round(playlist.matchScore * 100)}
									suffix="%"
									className={`${isGoodMatch ? "theme-text" : "theme-text-muted"} font-extralight tabular-nums`}
									style={{
										fontFamily: fonts.display,
										fontSize: "2rem",
									}}
								/>
							}
							reason={
								reconnectNeeded ? undefined : playlist.reason || undefined
							}
							colors={theme}
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

			<div
				className="flex items-center justify-between"
				style={{
					marginTop: "2rem",
				}}
			>
				<button
					type="button"
					onClick={onDismiss}
					className="theme-text-muted text-xs tracking-widest uppercase transition-[transform,opacity] duration-100 hover:opacity-70 active:scale-[0.98]"
					style={{ fontFamily: fonts.body }}
				>
					Dismiss
				</button>

				<button
					type="button"
					onClick={onNext}
					className="theme-text group inline-flex items-center gap-3 transition-transform duration-100 active:scale-[0.98]"
					style={{ fontFamily: fonts.body }}
				>
					<span className="text-base font-medium tracking-wide">Next Song</span>
					<span className="theme-text-muted inline-block transition-transform group-hover:translate-x-1">
						&rarr;
					</span>
				</button>
			</div>
		</div>
	);
});
