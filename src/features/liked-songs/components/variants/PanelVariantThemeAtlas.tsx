import { useMemo, useState } from "react";
import type { AnalysisContent, LikedSong } from "@/features/liked-songs/types";
import { fonts } from "@/lib/theme/fonts";
import { useThemeWithOverride } from "@/lib/theme/ThemeHueProvider";
import type { ThemeConfig } from "@/lib/theme/types";
import { GenreRow, HeadlineToggle } from "./_ProdPrimitives";
import { HeroTitleBlock, VariantShell } from "./_VariantShell";

interface Props {
	song: LikedSong;
	albumArtUrl?: string;
	artistImageUrl?: string;
	isExpanded: boolean;
	onClose: () => void;
}

export function PanelVariantThemeAtlas({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis as AnalysisContent | undefined;
	const [active, setActive] = useState(0);

	const themes = analysis?.themes ?? [];
	const safe = themes.length > 0 ? Math.min(active, themes.length - 1) : 0;
	const current = themes[safe];

	const evidence = useMemo(() => {
		if (!analysis || !current) return null;
		const lc = current.name.toLowerCase();
		const matchingLines =
			(analysis.key_lines ?? []).filter((l) => {
				const text = `${l.line} ${l.insight}`.toLowerCase();
				for (const w of current.name.split(/\s+/)) {
					if (w.length >= 4 && text.includes(w.toLowerCase())) return true;
				}
				return false;
			});
		const matchingSections =
			(analysis.journey ?? []).filter((j) => {
				const text = `${j.mood} ${j.description}`.toLowerCase();
				for (const w of current.name.split(/\s+/)) {
					if (w.length >= 4 && text.includes(w.toLowerCase())) return true;
				}
				return text.includes(lc);
			});
		return {
			lines: matchingLines.length > 0
				? matchingLines
				: (analysis.key_lines ?? []).slice(0, 1),
			sections: matchingSections.length > 0
				? matchingSections
				: (analysis.journey ?? []).slice(
						Math.floor((safe / Math.max(themes.length, 1)) * (analysis.journey?.length ?? 0)),
						Math.floor((safe / Math.max(themes.length, 1)) * (analysis.journey?.length ?? 0)) + 1,
					),
		};
	}, [analysis, current, safe, themes.length]);

	return (
		<VariantShell
			theme={theme}
			song={song}
			albumArtUrl={albumArtUrl}
			artistImageUrl={artistImageUrl}
			isExpanded={isExpanded}
			onClose={onClose}
			heroOverlay={<HeroTitleBlock song={song} theme={theme} />}
		>
			<div
				style={{
					padding: "56px 24px 80px",
					display: "flex",
					flexDirection: "column",
					gap: 24,
				}}
			>
				<GenreRow genres={song.track.genres} theme={theme} />

				{!analysis?.headline ? (
					<EmptyState theme={theme} />
				) : (
					<>
						<HeadlineToggle
							headline={analysis.headline}
							interpretation={analysis.interpretation}
							theme={theme}
							size={28}
						/>

						{themes.length === 0 ? (
							<p
								style={{
									fontFamily: fonts.body,
									fontStyle: "italic",
									fontSize: 14,
									color: theme.textMuted,
									margin: 0,
								}}
							>
								No themes named yet.
							</p>
						) : (
							<>
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										gap: 0,
										paddingTop: 4,
										borderTop: `1px solid ${theme.border}`,
									}}
								>
									{themes.map((t, i) => {
										const isActive = i === safe;
										return (
											<button
												key={`${t.name}-${i}`}
												type="button"
												onClick={() => setActive(i)}
												style={{
													background: "transparent",
													border: "none",
													padding: "12px 0",
													borderBottom: `1px solid ${theme.border}`,
													cursor: "pointer",
													textAlign: "left",
													display: "flex",
													alignItems: "baseline",
													justifyContent: "space-between",
													gap: 12,
												}}
											>
												<span
													style={{
														fontFamily: fonts.display,
														fontSize: isActive ? 18 : 16,
														color: isActive ? theme.primary : theme.text,
														fontStyle: isActive ? "italic" : "normal",
														transition: "color 160ms ease",
													}}
												>
													{t.name}
												</span>
												<span
													style={{
														fontFamily: fonts.body,
														fontSize: 10,
														letterSpacing: "0.08em",
														textTransform: "uppercase",
														color: isActive ? theme.primary : theme.textMuted,
													}}
												>
													{isActive ? "viewing" : `lens ${i + 1}`}
												</span>
											</button>
										);
									})}
								</div>

								{current && evidence && (
									<div
										key={safe}
										style={{
											animation: "hearted-fade 280ms ease",
											display: "flex",
											flexDirection: "column",
											gap: 18,
										}}
									>
										<p
											style={{
												fontFamily: fonts.body,
												fontSize: 14,
												lineHeight: 1.7,
												color: theme.text,
												margin: 0,
											}}
										>
											{current.description}
										</p>

										{evidence.lines.length > 0 && (
											<div>
												<Label theme={theme}>
													{evidence.lines.length === 1
														? "shown in this line"
														: `shown in ${evidence.lines.length} lines`}
												</Label>
												<div
													style={{
														display: "flex",
														flexDirection: "column",
														gap: 10,
														marginTop: 8,
													}}
												>
													{evidence.lines.map((l, i) => (
														<blockquote
															key={i}
															style={{
																margin: 0,
																paddingLeft: 12,
																borderLeft: `2px solid ${theme.primary}`,
															}}
														>
															<p
																style={{
																	fontFamily: fonts.display,
																	fontStyle: "italic",
																	fontSize: 16,
																	lineHeight: 1.4,
																	color: theme.text,
																	margin: 0,
																}}
															>
																&ldquo;{l.line}&rdquo;
															</p>
															<p
																style={{
																	fontFamily: fonts.body,
																	fontSize: 12,
																	lineHeight: 1.55,
																	color: theme.textMuted,
																	margin: "6px 0 0",
																}}
															>
																{l.insight}
															</p>
														</blockquote>
													))}
												</div>
											</div>
										)}

										{evidence.sections.length > 0 && (
											<div>
												<Label theme={theme}>
													{evidence.sections.length === 1
														? "surfaces here in the song"
														: `surfaces in ${evidence.sections.length} sections`}
												</Label>
												<div
													style={{
														display: "flex",
														flexDirection: "column",
														gap: 8,
														marginTop: 8,
													}}
												>
													{evidence.sections.map((s, i) => (
														<div
															key={`${s.section}-${i}`}
															style={{
																padding: "10px 12px",
																background: theme.surface,
																borderRadius: 4,
															}}
														>
															<span
																style={{
																	fontFamily: fonts.body,
																	fontSize: 10,
																	letterSpacing: "0.1em",
																	textTransform: "uppercase",
																	color: theme.primary,
																}}
															>
																{s.section}
															</span>
															<div
																style={{
																	fontFamily: fonts.display,
																	fontStyle: "italic",
																	fontSize: 13,
																	color: theme.text,
																	marginTop: 2,
																}}
															>
																{s.mood}
															</div>
														</div>
													))}
												</div>
											</div>
										)}
									</div>
								)}
							</>
						)}
					</>
				)}
			</div>
		</VariantShell>
	);
}

function Label({
	theme,
	children,
}: {
	theme: ThemeConfig;
	children: React.ReactNode;
}) {
	return (
		<span
			style={{
				fontFamily: fonts.body,
				fontSize: 9,
				letterSpacing: "0.12em",
				textTransform: "uppercase",
				color: theme.textMuted,
			}}
		>
			{children}
		</span>
	);
}

function EmptyState({ theme }: { theme: ThemeConfig }) {
	return (
		<p
			style={{
				fontFamily: fonts.display,
				fontSize: 22,
				lineHeight: 1.4,
				color: theme.textMuted,
				fontStyle: "italic",
				margin: 0,
			}}
		>
			Still listening. Come back soon.
		</p>
	);
}
