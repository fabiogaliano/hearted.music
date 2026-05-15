import { useState } from "react";
import type { AnalysisContent, LikedSong } from "@/features/liked-songs/types";
import { fonts } from "@/lib/theme/fonts";
import { useThemeWithOverride } from "@/lib/theme/ThemeHueProvider";
import {
	GenreRow,
	HeadlineToggle,
	JourneyDisplay,
	KeyLinesDisplay,
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

export function PanelVariantQuoteFirst({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis as AnalysisContent | undefined;
	const [showInsight, setShowInsight] = useState(false);
	const leadLine = analysis?.key_lines?.[0];
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
						{leadLine && (
							<button
								type="button"
								onClick={() => setShowInsight((v) => !v)}
								style={{
									background: "transparent",
									border: "none",
									padding: 0,
									textAlign: "left",
									cursor: "pointer",
									width: "100%",
								}}
								aria-expanded={showInsight}
							>
								<p
									style={{
										fontFamily: fonts.display,
										fontStyle: "italic",
										fontSize: 22,
										lineHeight: 1.45,
										color: theme.text,
										margin: 0,
										whiteSpace: "pre-line",
									}}
								>
									&ldquo;{leadLine.line}&rdquo;
								</p>
								<div
									style={{
										maxHeight: showInsight ? 200 : 0,
										overflow: "hidden",
										transition: "max-height 240ms ease",
									}}
								>
									<p
										style={{
											fontFamily: fonts.body,
											fontSize: 13,
											lineHeight: 1.6,
											color: theme.textMuted,
											margin: 0,
											marginTop: 12,
											paddingLeft: 12,
											borderLeft: `2px solid ${theme.primary}`,
										}}
									>
										{leadLine.insight}
									</p>
								</div>
							</button>
						)}

						{analysis.headline && (
							<div
								style={{
									paddingTop: 22,
									borderTop: `1px solid ${theme.border}`,
								}}
							>
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

						{analysis.journey && analysis.journey.length > 0 && (
							<JourneyDisplay journey={analysis.journey} theme={theme} />
						)}

						{restLines.length > 0 && (
							<KeyLinesDisplay keyLines={restLines} theme={theme} />
						)}
					</>
				)}
			</div>
		</VariantShell>
	);
}
