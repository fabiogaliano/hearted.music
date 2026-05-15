import { useState } from "react";
import type { AnalysisContent, LikedSong } from "@/features/liked-songs/types";
import { fonts } from "@/lib/theme/fonts";
import { useThemeWithOverride } from "@/lib/theme/ThemeHueProvider";
import {
	GenreRow,
	HeadlineToggle,
	JourneyDisplay,
	KeyLinesDisplay,
	MoodBlock,
	ThemesInline,
} from "./_ProdPrimitives";
import { HeroTitleBlock, VariantShell } from "./_VariantShell";

interface Props {
	song: LikedSong;
	albumArtUrl?: string;
	artistImageUrl?: string;
	isExpanded: boolean;
	onClose: () => void;
}

export function PanelVariantCompactStack({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis as AnalysisContent | undefined;
	const [showAllLines, setShowAllLines] = useState(false);
	const [showJourney, setShowJourney] = useState(false);

	const firstLine = analysis?.key_lines?.slice(0, 1);
	const restLines = analysis?.key_lines?.slice(1) ?? [];

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
							<div>
								<HeadlineToggle
									headline={analysis.headline}
									interpretation={analysis.interpretation}
									theme={theme}
									size={20}
								/>
								{analysis.themes && analysis.themes.length > 0 && (
									<div style={{ marginTop: 14 }}>
										<ThemesInline themes={analysis.themes} theme={theme} />
									</div>
								)}
							</div>
						)}

						{firstLine && firstLine.length > 0 && (
							<div>
								<KeyLinesDisplay
									keyLines={showAllLines ? analysis.key_lines! : firstLine}
									theme={theme}
								/>
								{restLines.length > 0 && (
									<button
										type="button"
										onClick={() => setShowAllLines((v) => !v)}
										style={{
											background: "transparent",
											border: "none",
											padding: "8px 0 0",
											cursor: "pointer",
											fontFamily: fonts.body,
											fontSize: 10,
											letterSpacing: "0.08em",
											textTransform: "uppercase",
											color: theme.textMuted,
										}}
									>
										{showAllLines
											? "← fewer"
											: `+${restLines.length} more line${restLines.length > 1 ? "s" : ""} →`}
									</button>
								)}
							</div>
						)}

						{analysis.journey && analysis.journey.length > 0 && (
							<div>
								{showJourney ? (
									<JourneyDisplay
										journey={analysis.journey}
										theme={theme}
										showHeader
									/>
								) : (
									<button
										type="button"
										onClick={() => setShowJourney(true)}
										style={{
											background: "transparent",
											border: `1px solid ${theme.border}`,
											borderRadius: 4,
											padding: "10px 14px",
											cursor: "pointer",
											fontFamily: fonts.body,
											fontSize: 11,
											letterSpacing: "0.06em",
											color: theme.text,
											width: "100%",
											textAlign: "left",
											display: "flex",
											justifyContent: "space-between",
											alignItems: "center",
										}}
									>
										<span>
											How it moves —{" "}
											<span style={{ color: theme.textMuted }}>
												{analysis.journey.map((j) => j.section).join(" → ")}
											</span>
										</span>
										<span style={{ color: theme.textMuted }}>→</span>
									</button>
								)}
							</div>
						)}

						{(analysis.compound_mood || analysis.mood_description) && (
							<div
								style={{
									paddingTop: 20,
									borderTop: `1px solid ${theme.border}`,
								}}
							>
								<MoodBlock
									compoundMood={analysis.compound_mood}
									moodDescription={analysis.mood_description}
									theme={theme}
								/>
							</div>
						)}
					</>
				)}
			</div>
		</VariantShell>
	);
}
