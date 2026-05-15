import { useState } from "react";
import type { AnalysisContent, LikedSong } from "@/features/liked-songs/types";
import { fonts } from "@/lib/theme/fonts";
import { useThemeWithOverride } from "@/lib/theme/ThemeHueProvider";
import {
	GenreRow,
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

export function PanelVariantTapReveal({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis as AnalysisContent | undefined;
	const [revealed, setRevealed] = useState(false);

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
							<button
								type="button"
								onClick={() => setRevealed((v) => !v)}
								aria-expanded={revealed}
								style={{
									background: "transparent",
									border: "none",
									padding: 0,
									textAlign: "left",
									cursor: "pointer",
									width: "100%",
								}}
							>
								<p
									style={{
										fontFamily: fonts.display,
										fontSize: 26,
										fontWeight: 400,
										lineHeight: 1.3,
										color: theme.text,
										margin: 0,
									}}
								>
									{analysis.headline}
								</p>
								<span
									style={{
										fontFamily: fonts.body,
										fontSize: 11,
										letterSpacing: "0.04em",
										color: theme.textMuted,
										marginTop: 10,
										display: "inline-block",
									}}
								>
									{revealed ? "← back" : "read deeper →"}
								</span>
							</button>
						)}

						{revealed && (
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: 28,
									animation: "hearted-push-up 280ms ease",
								}}
							>
								{analysis.interpretation && (
									<p
										style={{
											fontFamily: fonts.body,
											fontSize: 16,
											fontStyle: "italic",
											lineHeight: 1.55,
											color: theme.textMuted,
											margin: 0,
											borderLeft: `2px solid ${theme.primary}`,
											paddingLeft: 12,
										}}
									>
										{analysis.interpretation}
									</p>
								)}

								{analysis.themes && analysis.themes.length > 0 && (
									<ThemesInline themes={analysis.themes} theme={theme} />
								)}

								{analysis.key_lines && analysis.key_lines.length > 0 && (
									<KeyLinesDisplay
										keyLines={analysis.key_lines}
										theme={theme}
									/>
								)}

								{analysis.journey && analysis.journey.length > 0 && (
									<JourneyDisplay
										journey={analysis.journey}
										theme={theme}
										showHeader
									/>
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
							</div>
						)}
					</>
				)}
			</div>
		</VariantShell>
	);
}
