import { useMemo, useState } from "react";
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

export function PanelVariantScrubTape({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis;
	const [position, setPosition] = useState(0);
	const [pinnedTheme, setPinnedTheme] = useState<number | null>(null);
	const [openRead, setOpenRead] = useState(false);

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
					<ScrubTapeBody
						analysis={analysis}
						theme={theme}
						position={position}
						onPosition={setPosition}
						pinnedTheme={pinnedTheme}
						onPinnedTheme={setPinnedTheme}
						openRead={openRead}
						onOpenRead={setOpenRead}
					/>
				)}
			</div>
		</VariantShell>
	);
}

function ScrubTapeBody({
	analysis,
	theme,
	position,
	onPosition,
	pinnedTheme,
	onPinnedTheme,
	openRead,
	onOpenRead,
}: {
	analysis: AnalysisContent;
	theme: ThemeConfig;
	position: number;
	onPosition: (value: number) => void;
	pinnedTheme: number | null;
	onPinnedTheme: (value: number | null) => void;
	openRead: boolean;
	onOpenRead: (value: boolean) => void;
}) {
	const headline = analysis.headline;
	const compoundMood = analysis.compound_mood;
	const moodDescription = analysis.mood_description;
	const interpretation = analysis.interpretation;
	const themes = analysis.themes ?? [];
	const journey = analysis.journey ?? [];
	const keyLines = analysis.key_lines ?? [];
	const sonicTexture = analysis.sonic_texture;
	const max = Math.max(journey.length - 1, 0);
	const safePosition = Math.min(position, max);
	const activeJourney = journey[safePosition];
	const activeLine =
		keyLines.length > 0 ? keyLines[safePosition % keyLines.length] : undefined;
	const activeTheme =
		pinnedTheme != null
			? themes[pinnedTheme]
			: themes[safePosition % Math.max(themes.length, 1)];

	const tapeMarks = useMemo(
		() => journey.map((step, index) => ({ label: step.section, index })),
		[journey],
	);

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
				<button
					type="button"
					onClick={() => onOpenRead(!openRead)}
					style={{
						alignSelf: "flex-start",
						background: "transparent",
						border: `1px solid ${theme.border}`,
						borderRadius: 2,
						color: theme.textMuted,
						cursor: "pointer",
						fontFamily: fonts.body,
						fontSize: 11,
						padding: "5px 8px",
					}}
				>
					{openRead ? "close the read" : "read deeper"}
				</button>
				{openRead && interpretation && (
					<p
						style={{
							fontFamily: fonts.body,
							fontSize: 14,
							lineHeight: 1.65,
							color: theme.textMuted,
							borderLeft: `1px solid ${theme.primary}`,
							paddingLeft: 12,
							margin: 0,
						}}
					>
						{interpretation}
					</p>
				)}
			</div>

			<div
				style={{
					borderTop: `1px solid ${theme.border}`,
					borderBottom: `1px solid ${theme.border}`,
					padding: "22px 0",
					display: "flex",
					flexDirection: "column",
					gap: 18,
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: 16,
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
						{compoundMood ?? "how it moves"}
					</span>
					<span
						style={{
							fontFamily: fonts.body,
							fontSize: 11,
							color: theme.textMuted,
						}}
					>
						{activeJourney?.section ?? "start"}
					</span>
				</div>
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "18px 1fr 18px",
						gap: 12,
						alignItems: "center",
					}}
				>
					<span style={{ height: 1, background: theme.border }} />
					<input
						type="range"
						min={0}
						max={max}
						value={safePosition}
						onChange={(event) => onPosition(Number(event.currentTarget.value))}
						aria-label="Scrub through the song journey"
						style={{
							width: "100%",
							accentColor: theme.primary,
							cursor: "grab",
						}}
					/>
					<span style={{ height: 1, background: theme.border }} />
				</div>
				<div
					style={{
						display: "grid",
						gridTemplateColumns: `repeat(${Math.max(tapeMarks.length, 1)}, 1fr)`,
						gap: 6,
					}}
				>
					{tapeMarks.map((mark) => (
						<button
							key={`${mark.label}-${mark.index}`}
							type="button"
							onClick={() => onPosition(mark.index)}
							style={{
								height: 36,
								border: `1px solid ${mark.index === safePosition ? theme.primary : theme.border}`,
								borderRadius: 1,
								background:
									mark.index === safePosition ? theme.surface : "transparent",
								color:
									mark.index === safePosition ? theme.text : theme.textMuted,
								cursor: "pointer",
								fontFamily: fonts.body,
								fontSize: 9,
								overflow: "hidden",
								textOverflow: "ellipsis",
							}}
						>
							{mark.label}
						</button>
					))}
				</div>
				{activeJourney && (
					<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
						<div
							style={{
								fontFamily: fonts.display,
								fontSize: 22,
								fontStyle: "italic",
								color: theme.text,
							}}
						>
							{activeJourney.mood}
						</div>
						<p
							style={{
								fontFamily: fonts.body,
								fontSize: 13,
								lineHeight: 1.6,
								color: theme.textMuted,
								margin: 0,
							}}
						>
							{activeJourney.description}
						</p>
					</div>
				)}
			</div>

			<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
				<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
					{activeLine && (
						<blockquote
							style={{
								margin: 0,
								padding: 12,
								border: `1px solid ${theme.border}`,
								borderRadius: 2,
							}}
						>
							<p
								style={{
									fontFamily: fonts.display,
									fontSize: 17,
									fontStyle: "italic",
									lineHeight: 1.45,
									color: theme.text,
									margin: 0,
								}}
							>
								&ldquo;{activeLine.line}&rdquo;
							</p>
							<p
								style={{
									fontFamily: fonts.body,
									fontSize: 12,
									lineHeight: 1.5,
									color: theme.textMuted,
									margin: "8px 0 0",
								}}
							>
								{activeLine.insight}
							</p>
						</blockquote>
					)}
					{moodDescription && (
						<p
							style={{
								fontFamily: fonts.body,
								fontSize: 13,
								fontStyle: "italic",
								lineHeight: 1.55,
								color: theme.textMuted,
								margin: 0,
							}}
						>
							{moodDescription}
						</p>
					)}
				</div>

				<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
					<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
						{themes.map((item, index) => {
							const active = activeTheme?.name === item.name;
							return (
								<button
									key={`${item.name}-${index}`}
									type="button"
									onClick={() =>
										onPinnedTheme(pinnedTheme === index ? null : index)
									}
									style={{
										background: active ? theme.primary : "transparent",
										border: `1px solid ${active ? theme.primary : theme.border}`,
										borderRadius: 2,
										color: active ? theme.textOnPrimary : theme.textMuted,
										cursor: "pointer",
										fontFamily: fonts.body,
										fontSize: 11,
										padding: "5px 7px",
										transition: "background 180ms ease, color 180ms ease",
									}}
								>
									{item.name}
								</button>
							);
						})}
					</div>
					{activeTheme && (
						<p
							style={{
								fontFamily: fonts.body,
								fontSize: 12,
								lineHeight: 1.55,
								color: theme.textMuted,
								margin: 0,
							}}
						>
							{activeTheme.description}
						</p>
					)}
					{sonicTexture && (
						<p
							style={{
								fontFamily: fonts.body,
								fontSize: 12,
								lineHeight: 1.55,
								color: theme.textMuted,
								paddingTop: 12,
								borderTop: `1px solid ${theme.border}`,
								margin: 0,
							}}
						>
							{sonicTexture}
						</p>
					)}
				</div>
			</div>
		</>
	);
}
