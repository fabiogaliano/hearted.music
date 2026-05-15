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

export function PanelVariantWideOpen({
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
					padding: "56px 24px 96px",
					display: "flex",
					flexDirection: "column",
					gap: 40,
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
						)}

						{analysis.interpretation && (
							<p
								style={{
									fontFamily: fonts.body,
									fontStyle: "italic",
									fontSize: 16,
									lineHeight: 1.7,
									color: theme.textMuted,
									margin: 0,
									borderLeft: `2px solid ${theme.primary}`,
									paddingLeft: 14,
								}}
							>
								{analysis.interpretation}
							</p>
						)}

						{analysis.themes && analysis.themes.length > 0 && (
							<ThemesInline themes={analysis.themes} theme={theme} />
						)}

						{analysis.journey && analysis.journey.length > 0 && (
							<JourneyDisplay
								journey={analysis.journey}
								theme={theme}
								showHeader
							/>
						)}

						{analysis.key_lines && analysis.key_lines.length > 0 && (
							<KeyLinesDisplay keyLines={analysis.key_lines} theme={theme} />
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
