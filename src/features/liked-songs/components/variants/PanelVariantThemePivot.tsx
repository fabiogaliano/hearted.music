import { useState } from "react";
import type { AnalysisContent, LikedSong } from "@/features/liked-songs/types";
import { fonts } from "@/lib/theme/fonts";
import { useThemeWithOverride } from "@/lib/theme/ThemeHueProvider";
import {
	GenreRow,
	HeadlineToggle,
	JourneyDisplay,
	KeyLinesDisplay,
} from "./_ProdPrimitives";
import { HeroTitleBlock, VariantShell } from "./_VariantShell";

interface Props {
	song: LikedSong;
	albumArtUrl?: string;
	artistImageUrl?: string;
	isExpanded: boolean;
	onClose: () => void;
}

export function PanelVariantThemePivot({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis as AnalysisContent | undefined;
	const [activeTheme, setActiveTheme] = useState<number | null>(null);
	const themes = analysis?.themes ?? [];
	const selected = activeTheme != null ? themes[activeTheme] : null;

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
					gap: 28,
				}}
			>
				<GenreRow genres={song.track.genres} theme={theme} />

				{!analysis ? (
					<p
						style={{
							fontFamily: fonts.display,
							fontSize: 22,
							fontWeight: 400,
							lineHeight: 1.4,
							color: theme.textMuted,
							fontStyle: "italic",
							margin: 0,
						}}
					>
						Still listening. Come back soon.
					</p>
				) : (
					<>
						{analysis.headline && (
							<HeadlineToggle
								headline={analysis.headline}
								interpretation={analysis.interpretation}
								theme={theme}
							/>
						)}

						{themes.length > 0 && (
							<div>
								<div
									style={{
										fontFamily: fonts.body,
										fontSize: 10,
										fontWeight: 500,
										letterSpacing: "0.08em",
										textTransform: "uppercase",
										color: theme.textMuted,
										marginBottom: 12,
									}}
								>
									Themes — tap to read
								</div>
								<p
									style={{
										fontFamily: fonts.body,
										fontSize: 13,
										lineHeight: 1.55,
										margin: 0,
									}}
								>
									{themes.map((t, i) => {
										const active = activeTheme === i;
										return (
											<button
												key={`${t.name}-${i}`}
												type="button"
												onClick={() => setActiveTheme(active ? null : i)}
												style={{
													background: "transparent",
													border: "none",
													padding: 0,
													cursor: "pointer",
													fontFamily: fonts.body,
													fontSize: 13,
													color: active ? theme.primary : theme.text,
													letterSpacing: "0.02em",
													transition: "color 200ms ease",
												}}
											>
												{t.name}
												{i < themes.length - 1 && (
													<span
														style={{
															opacity: 0.45,
															margin: "0 7px",
															color: theme.textMuted,
														}}
													>
														·
													</span>
												)}
											</button>
										);
									})}
								</p>
								<div
									style={{
										maxHeight: selected ? 200 : 0,
										overflow: "hidden",
										transition: "max-height 280ms ease",
									}}
								>
									{selected && (
										<p
											style={{
												fontFamily: fonts.body,
												fontStyle: "italic",
												fontSize: 13,
												lineHeight: 1.6,
												color: theme.textMuted,
												margin: 0,
												marginTop: 12,
												paddingLeft: 12,
												borderLeft: `2px solid ${theme.primary}`,
											}}
										>
											{selected.description}
										</p>
									)}
								</div>
							</div>
						)}

						{analysis.key_lines && analysis.key_lines.length > 0 && (
							<KeyLinesDisplay keyLines={analysis.key_lines} theme={theme} />
						)}

						{analysis.journey && analysis.journey.length > 0 && (
							<JourneyDisplay journey={analysis.journey} theme={theme} />
						)}
					</>
				)}
			</div>
		</VariantShell>
	);
}
