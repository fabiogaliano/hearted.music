import type { Song } from "@/lib/data/mock-data";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";

interface DetailsPanelProps {
	song: Song;
	isExpanded: boolean;
	activeJourneyStep: number;
	onJourneyStepHover: (index: number) => void;
	onClose: () => void;
}

export function DetailsPanel({
	song,
	isExpanded,
	activeJourneyStep,
	onJourneyStepHover,
	onClose,
}: DetailsPanelProps) {
	const theme = useTheme();

	return (
		<div
			className="overflow-hidden transition-[max-height,opacity,margin-top] duration-500 ease-in-out"
			style={{
				maxHeight: isExpanded ? "min(600px, calc(100vh - 300px))" : "0",
				opacity: isExpanded ? 1 : 0,
				marginTop: isExpanded ? "1.5rem" : "0",
			}}
		>
			<div>
				<div className="mb-8 grid gap-8 lg:grid-cols-2">
					<button
						onClick={onClose}
						className="text-left text-sm tracking-widest uppercase transition-all duration-300 hover:opacity-70"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						Hide −
					</button>
					<p
						className="text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						The Emotional Journey
					</p>
				</div>

				<div className="grid gap-8 lg:grid-cols-2">
					<div className="space-y-5">
						<div>
							<p
								className="text-xl leading-relaxed font-extralight"
								style={{
									fontFamily: fonts.display,
									color: theme.text,
									fontStyle: "italic",
								}}
							>
								"{song.keyLines[0].text}"
							</p>
						</div>

						<div>
							<p
								className="mb-2 text-xs tracking-widest uppercase"
								style={{ fontFamily: fonts.body, color: theme.textMuted }}
							>
								Themes
							</p>
							<div className="flex flex-wrap gap-2">
								{song.themes.map((t, i) => (
									<span
										key={i}
										className="px-3 py-1 text-sm"
										style={{
											fontFamily: fonts.body,
											color: theme.text,
											background: theme.surface,
										}}
									>
										{t.name}
									</span>
								))}
							</div>
						</div>

						<div>
							<p
								className="mb-2 text-xs tracking-widest uppercase"
								style={{ fontFamily: fonts.body, color: theme.textMuted }}
							>
								Meaning
							</p>
							<p
								className="text-sm leading-relaxed"
								style={{ fontFamily: fonts.body, color: theme.text }}
							>
								{song.keyLines[0].meaning}
							</p>
						</div>

						<div>
							<p
								className="mb-2 text-xs tracking-widest uppercase"
								style={{ fontFamily: fonts.body, color: theme.textMuted }}
							>
								Mood
							</p>
							<p
								className="text-sm"
								style={{ fontFamily: fonts.body, color: theme.text }}
							>
								{song.mood}
							</p>
						</div>
					</div>

					<div>
						<div className="relative">
							<div
								className="absolute top-3 bottom-3 left-3 w-px"
								style={{ background: theme.border }}
							/>

							<div className="space-y-1">
								{song.journey.map((step, i) => {
									const isActive = activeJourneyStep === i;

									return (
										<div
											key={i}
											onMouseEnter={() => onJourneyStepHover(i)}
											className="relative w-full cursor-pointer py-2 pl-8 text-left transition-all duration-300"
											style={{
												background: isActive ? theme.surface : "transparent",
											}}
										>
											<div
												className="absolute top-1/2 left-0 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border-2 transition-all duration-300"
												style={{
													borderColor: isActive ? theme.text : theme.border,
													background: isActive ? theme.text : theme.bg,
												}}
											>
												{isActive && (
													<div
														className="h-2 w-2 rounded-full"
														style={{ background: theme.bg }}
													/>
												)}
											</div>

											<p
												className="text-xs tracking-widest uppercase transition-all duration-300"
												style={{
													fontFamily: fonts.body,
													color: isActive ? theme.text : theme.textMuted,
												}}
											>
												{step.section}
											</p>

											<p
												className="mt-1 text-base font-extralight transition-all duration-300"
												style={{
													fontFamily: fonts.display,
													color: isActive ? theme.text : theme.textMuted,
													fontStyle: "italic",
												}}
											>
												{step.mood}
											</p>

											<div
												className="overflow-hidden transition-all duration-300"
												style={{
													maxHeight: isActive ? "60px" : "0",
													opacity: isActive ? 1 : 0,
												}}
											>
												<p
													className="mt-1 text-sm leading-relaxed"
													style={{
														fontFamily: fonts.body,
														color: theme.text,
													}}
												>
													{step.description}
												</p>
											</div>
										</div>
									);
								})}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
