import { AnimatePresence, motion } from "framer-motion";
import { ClientNumberFlow as NumberFlow } from "./ClientNumberFlow";
import type { Playlist } from "../types";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { PlaylistMatchRow } from "@/components/ui/PlaylistMatchRow";

const MIN_HEIGHT = "clamp(300px, 30vw, 560px)";

interface MatchesSectionProps {
	playlists: Playlist[];
	addedTo: string[];
	isDemo?: boolean;
	realAvailable?: boolean;
	onRefresh?: () => void;
	onAdd: (playlistId: string) => void;
	onDismiss: () => void;
	onNext: () => void;
}

export function MatchesSection({
	playlists,
	addedTo,
	isDemo,
	realAvailable,
	onRefresh,
	onAdd,
	onDismiss,
	onNext,
}: MatchesSectionProps) {
	const theme = useTheme();
	return (
		<div
			className="flex flex-col"
			style={{
				minHeight: MIN_HEIGHT,
			}}
		>
			<div className="flex items-center gap-2">
				<p
					className="text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Best Matches
				</p>
				{isDemo && (
					<span
						className="rounded-full px-2 py-0.5 text-[10px] tracking-widest uppercase"
						style={{
							fontFamily: fonts.body,
							color: theme.textMuted,
							background: theme.surface,
						}}
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
						initial={{ opacity: 0, height: 0 }}
						animate={{ opacity: 1, height: "auto" }}
						exit={{ opacity: 0, height: 0 }}
						transition={{ duration: 0.25, ease: [0.165, 0.84, 0.44, 1] }}
						className="mt-3 flex w-full items-center justify-between overflow-hidden rounded-lg px-4 py-2.5"
						style={{
							fontFamily: fonts.body,
							background: theme.surface,
							color: theme.text,
						}}
					>
						<span className="text-xs">Real matches are ready</span>
						<span
							className="text-xs font-medium tracking-wider uppercase"
							style={{ color: theme.primary }}
						>
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
				{playlists.map((playlist, slotIndex) => {
					const isGoodMatch = playlist.matchScore >= 0.7;
					return (
						<PlaylistMatchRow
							key={slotIndex}
							playlistId={playlist.id}
							name={playlist.name}
							scoreDisplay={
								<NumberFlow
									value={Math.round(playlist.matchScore * 100)}
									suffix="%"
									className="font-extralight tabular-nums"
									style={{
										fontFamily: fonts.display,
										color: isGoodMatch ? theme.text : theme.textMuted,
										fontSize: "2rem",
									}}
								/>
							}
							reason={playlist.reason || undefined}
							isAdded={addedTo.includes(playlist.id)}
							onAdd={onAdd}
							colors={theme}
							size="lg"
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
					onClick={onDismiss}
					className="text-sm tracking-widest uppercase"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Dismiss
				</button>

				<button
					onClick={onNext}
					className="group inline-flex items-center gap-3"
					style={{ fontFamily: fonts.body, color: theme.text }}
				>
					<span className="text-lg font-medium tracking-wide">Next Song</span>
					<span
						className="inline-block transition-transform group-hover:translate-x-1"
						style={{ color: theme.textMuted }}
					>
						&rarr;
					</span>
				</button>
			</div>
		</div>
	);
}
