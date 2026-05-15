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

export function PanelVariantMoodFirst({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis as AnalysisContent | undefined;

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
						{(analysis.compound_mood || analysis.mood_description) && (
							<div
								style={{ display: "flex", flexDirection: "column", gap: 10 }}
							>
								{analysis.compound_mood && (
									<div
										style={{
											fontFamily: fonts.display,
											fontWeight: 400,
											fontSize: 30,
											lineHeight: 1.1,
											color: theme.text,
										}}
									>
										{analysis.compound_mood}
									</div>
								)}
								{analysis.mood_description && (
									<p
										style={{
											fontFamily: fonts.body,
											fontStyle: "italic",
											fontSize: 15,
											lineHeight: 1.55,
											color: theme.textMuted,
											margin: 0,
										}}
									>
										{analysis.mood_description}
									</p>
								)}
							</div>
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
