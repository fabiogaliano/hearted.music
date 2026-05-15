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

export function PanelVariantLinesStage({
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
						{analysis.headline && (
							<HeadlineToggle
								headline={analysis.headline}
								interpretation={analysis.interpretation}
								theme={theme}
								size={18}
							/>
						)}

						{analysis.key_lines && analysis.key_lines.length > 0 && (
							<KeyLinesDisplay keyLines={analysis.key_lines} theme={theme} />
						)}

						{analysis.themes && analysis.themes.length > 0 && (
							<ThemesInline themes={analysis.themes} theme={theme} />
						)}

						{analysis.journey && analysis.journey.length > 0 && (
							<JourneyDisplay journey={analysis.journey} theme={theme} />
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
