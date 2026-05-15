import { useState } from "react";
import type { AnalysisContent, LikedSong } from "@/features/liked-songs/types";
import { fonts } from "@/lib/theme/fonts";
import { useThemeWithOverride } from "@/lib/theme/ThemeHueProvider";
import type { ThemeConfig } from "@/lib/theme/types";
import { GenreRow } from "./_ProdPrimitives";
import { HeroTitleBlock, VariantShell } from "./_VariantShell";

interface Props {
	song: LikedSong;
	albumArtUrl?: string;
	artistImageUrl?: string;
	isExpanded: boolean;
	onClose: () => void;
}

type EqBand =
	| "tempo"
	| "energy"
	| "valence"
	| "danceability"
	| "acousticness"
	| "instrumentalness"
	| "liveness"
	| "speechiness"
	| "loudness";
const BAND_LABELS: EqBand[] = [
	"tempo",
	"energy",
	"valence",
	"danceability",
	"acousticness",
	"instrumentalness",
	"liveness",
	"speechiness",
	"loudness",
];

export function PanelVariantEqualizer({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis;
	const [band, setBand] = useState<EqBand>("energy");
	const [hoveredLine, setHoveredLine] = useState<number | null>(null);

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
					<EqualizerBody
						analysis={analysis}
						theme={theme}
						band={band}
						setBand={setBand}
						hoveredLine={hoveredLine}
						setHoveredLine={setHoveredLine}
					/>
				)}
			</div>
		</VariantShell>
	);
}

function EqualizerBody({
	analysis,
	theme,
	band,
	setBand,
	hoveredLine,
	setHoveredLine,
}: {
	analysis: AnalysisContent;
	theme: ThemeConfig;
	band: EqBand;
	setBand: (band: EqBand) => void;
	hoveredLine: number | null;
	setHoveredLine: (index: number | null) => void;
}) {
	const headline = analysis.headline;
	const compoundMood = analysis.compound_mood;
	const moodDescription = analysis.mood_description;
	const interpretation = analysis.interpretation;
	const themes = analysis.themes ?? [];
	const journey = analysis.journey ?? [];
	const keyLines = analysis.key_lines ?? [];
	const sonicTexture = analysis.sonic_texture;
	const audioFeatures = analysis.audio_features;
	const values = BAND_LABELS.map((item) => ({
		band: item,
		value: normalizedFeature(item, audioFeatures),
	}));

	return (
		<>
			<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
				{headline && (
					<p
						style={{
							fontFamily: fonts.display,
							fontSize: 30,
							fontWeight: 400,
							lineHeight: 1.18,
							color: theme.text,
							margin: 0,
						}}
					>
						{headline}
					</p>
				)}
				<span
					style={{
						fontFamily: fonts.body,
						fontSize: 11,
						letterSpacing: "0.08em",
						textTransform: "uppercase",
						color: theme.primary,
					}}
				>
					{compoundMood ?? "sound-feel"}
				</span>
			</div>

			<div
				style={{
					display: "grid",
					gridTemplateColumns: "1fr 120px",
					gap: 18,
					alignItems: "stretch",
					borderTop: `1px solid ${theme.border}`,
					paddingTop: 18,
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "end",
						gap: 8,
						minHeight: 190,
						padding: "16px 12px",
						border: `1px solid ${theme.border}`,
						borderRadius: 2,
						background: theme.surface,
					}}
				>
					{values.map((item) => {
						const active = band === item.band;
						return (
							<button
								key={item.band}
								type="button"
								onClick={() => setBand(item.band)}
								style={{
									flex: 1,
									height: `${Math.max(18, item.value * 150)}px`,
									background: active
										? theme.primary
										: `color-mix(in srgb, ${theme.primary} 28%, ${theme.bg})`,
									border: `1px solid ${active ? theme.primary : theme.border}`,
									borderRadius: 1,
									cursor: "pointer",
									transition: "height 220ms ease, background 180ms ease",
									display: "flex",
									alignItems: "end",
									justifyContent: "center",
									padding: 2,
								}}
								aria-label={item.band}
							>
								<span
									style={{
										writingMode: "vertical-rl",
										transform: "rotate(180deg)",
										fontFamily: fonts.body,
										fontSize: 9,
										color: active ? theme.textOnPrimary : theme.textMuted,
										letterSpacing: "0.04em",
									}}
								>
									{item.band.slice(0, 4)}
								</span>
							</button>
						);
					})}
				</div>
				<div
					style={{
						border: `1px solid ${theme.border}`,
						borderRadius: 2,
						padding: 12,
						display: "flex",
						flexDirection: "column",
						justifyContent: "space-between",
					}}
				>
					<span
						style={{
							fontFamily: fonts.body,
							fontSize: 10,
							letterSpacing: "0.08em",
							textTransform: "uppercase",
							color: theme.primary,
						}}
					>
						{band}
					</span>
					<span
						style={{
							fontFamily: fonts.display,
							fontSize: 38,
							color: theme.text,
						}}
					>
						{Math.round(normalizedFeature(band, audioFeatures) * 100)}
					</span>
					<span
						style={{
							fontFamily: fonts.body,
							fontSize: 11,
							lineHeight: 1.4,
							color: theme.textMuted,
						}}
					>
						{bandCopy(band)}
					</span>
				</div>
			</div>

			<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
				<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
					{sonicTexture && (
						<p
							style={{
								fontFamily: fonts.body,
								fontSize: 14,
								lineHeight: 1.7,
								color: theme.textMuted,
								margin: 0,
							}}
						>
							{sonicTexture}
						</p>
					)}
					{moodDescription && (
						<p
							style={{
								fontFamily: fonts.body,
								fontStyle: "italic",
								fontSize: 13,
								lineHeight: 1.6,
								color: theme.textMuted,
								margin: 0,
							}}
						>
							{moodDescription}
						</p>
					)}
					{interpretation && (
						<p
							style={{
								fontFamily: fonts.body,
								fontSize: 13,
								lineHeight: 1.6,
								color: theme.textMuted,
								margin: 0,
							}}
						>
							{interpretation}
						</p>
					)}
				</div>
				<div
					style={{ display: "flex", flexDirection: "column", gap: 12 }}
					onMouseLeave={() => setHoveredLine(null)}
				>
					{keyLines.map((item, index) => (
						<div
							key={`${item.line}-${index}`}
							onMouseEnter={() => setHoveredLine(index)}
							style={{
								borderBottom: `1px solid ${theme.border}`,
								paddingBottom: 10,
							}}
						>
							<p
								style={{
									fontFamily: fonts.display,
									fontSize: 16,
									fontStyle: "italic",
									lineHeight: 1.4,
									color: hoveredLine === index ? theme.text : theme.textMuted,
									margin: 0,
								}}
							>
								&ldquo;{item.line}&rdquo;
							</p>
							<div
								style={{
									maxHeight: hoveredLine === index ? 80 : 0,
									opacity: hoveredLine === index ? 1 : 0,
									overflow: "hidden",
									transition: "max-height 220ms ease, opacity 180ms ease",
								}}
							>
								<p
									style={{
										fontFamily: fonts.body,
										fontSize: 12,
										lineHeight: 1.5,
										color: theme.textMuted,
										margin: "5px 0 0",
									}}
								>
									{item.insight}
								</p>
							</div>
						</div>
					))}
				</div>
			</div>

			<div
				style={{
					borderTop: `1px solid ${theme.border}`,
					paddingTop: 16,
					display: "grid",
					gridTemplateColumns: "1fr 1fr",
					gap: 16,
				}}
			>
				<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
					{themes.map((item) => (
						<div key={`${item.name}-eq`}>
							<span
								style={{
									fontFamily: fonts.display,
									fontSize: 17,
									color: theme.text,
								}}
							>
								{item.name}
							</span>
							<p
								style={{
									fontFamily: fonts.body,
									fontSize: 12,
									lineHeight: 1.45,
									color: theme.textMuted,
									margin: "3px 0 0",
								}}
							>
								{item.description}
							</p>
						</div>
					))}
				</div>
				<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
					{journey.map((item) => (
						<div key={`${item.section}-eq`}>
							<span
								style={{
									fontFamily: fonts.body,
									fontSize: 10,
									letterSpacing: "0.08em",
									textTransform: "uppercase",
									color: theme.primary,
								}}
							>
								{item.section}
							</span>
							<p
								style={{
									fontFamily: fonts.body,
									fontSize: 12,
									lineHeight: 1.45,
									color: theme.textMuted,
									margin: "3px 0 0",
								}}
							>
								{item.mood}, {item.description}
							</p>
						</div>
					))}
				</div>
			</div>
		</>
	);
}

function normalizedFeature(
	band: EqBand,
	features: AnalysisContent["audio_features"],
): number {
	const raw = features?.[band];
	if (typeof raw !== "number") return 0.45;
	if (band === "tempo") return Math.max(0.12, Math.min(raw / 200, 1));
	if (band === "loudness") return Math.max(0.12, Math.min((raw + 60) / 60, 1));
	return Math.max(0.06, Math.min(raw, 1));
}

function bandCopy(band: EqBand): string {
	if (band === "tempo") return "the pace under the feeling";
	if (band === "energy") return "how hard it pushes";
	if (band === "valence") return "how bright or shaded it feels";
	if (band === "danceability") return "the body in the song";
	if (band === "acousticness") return "how close the room feels";
	if (band === "instrumentalness") return "space left for words";
	if (band === "liveness") return "the sense of air around it";
	if (band === "speechiness") return "how much it talks back";
	return "the weight in the mix";
}
