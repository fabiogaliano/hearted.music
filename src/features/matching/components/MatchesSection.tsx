import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ClientNumberFlow as NumberFlow } from "./ClientNumberFlow";
import type { Playlist } from "../types";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";

const MIN_HEIGHT = "clamp(300px, 30vw, 560px)";

interface MatchesSectionProps {
	playlists: Playlist[];
	addedTo: string[];
	onAdd: (playlistId: string) => void;
	onDismiss: () => void;
	onNext: () => void;
	songKey?: string;
}

export function MatchesSection({
	playlists,
	addedTo,
	onAdd,
	onDismiss,
	onNext,
	songKey,
}: MatchesSectionProps) {
	const theme = useTheme();
	const prefersReducedMotion = useReducedMotion();
	return (
		<div
			className="flex flex-col"
			style={{
				minHeight: MIN_HEIGHT,
			}}
		>
			<p
				className="text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				Best Matches
			</p>

			<div
				className="flex min-h-0 flex-1 flex-col"
				style={{
					marginTop: "1.5rem",
					gap: "1.25rem",
				}}
			>
				{playlists.map((playlist, slotIndex) => {
					const isAdded = addedTo.includes(playlist.id);
					const isGoodMatch = playlist.matchScore >= 0.7;

					return (
						<div
							key={slotIndex}
							className="group"
							style={{
								borderBottom: `1px solid ${theme.border}`,
								paddingBottom: "1.25rem",
							}}
						>
							<div className="flex items-start justify-between">
								<div className="flex items-start gap-3">
									{/* Stays fixed — digits roll to new value */}
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
									{/* Slides in/out with each song change */}
									<AnimatePresence mode="wait">
										<motion.div
											key={`${songKey}-${slotIndex}`}
											className="pt-1"
											initial={
												prefersReducedMotion ? false : { opacity: 0, x: 20 }
											}
											animate={{
												opacity: 1,
												x: 0,
												transition: {
													duration: 0.25,
													ease: [0.165, 0.84, 0.44, 1],
												},
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
											<h3
												className="font-light"
												style={{
													fontFamily: fonts.display,
													color: theme.text,
													fontSize: "1.125rem",
												}}
											>
												{playlist.name}
											</h3>
											{playlist.reason && (
												<p
													className="mt-0.5 text-xs"
													style={{
														fontFamily: fonts.body,
														color: theme.textMuted,
													}}
												>
													{playlist.reason}
												</p>
											)}
										</motion.div>
									</AnimatePresence>
								</div>

								{isAdded ? (
									<span
										className="text-sm tracking-widest uppercase opacity-50"
										style={{ fontFamily: fonts.body, color: theme.textMuted }}
									>
										Added
									</span>
								) : (
									<button
										onClick={() => onAdd(playlist.id)}
										className="text-sm tracking-widest uppercase opacity-0 transition-opacity group-hover:opacity-100"
										style={{ fontFamily: fonts.body, color: theme.text }}
									>
										Add
									</button>
								)}
							</div>
						</div>
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
