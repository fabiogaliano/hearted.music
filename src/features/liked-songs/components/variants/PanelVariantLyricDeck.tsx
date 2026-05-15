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

type DeckRail = "line" | "theme" | "journey";

export function PanelVariantLyricDeck({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis;
	const [card, setCard] = useState(0);
	const [rail, setRail] = useState<DeckRail>("line");
	const [hoverTheme, setHoverTheme] = useState<number | null>(null);

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
					<LyricDeckBody
						analysis={analysis}
						theme={theme}
						card={card}
						setCard={setCard}
						rail={rail}
						setRail={setRail}
						hoverTheme={hoverTheme}
						setHoverTheme={setHoverTheme}
					/>
				)}
			</div>
		</VariantShell>
	);
}

function LyricDeckBody({
	analysis,
	theme,
	card,
	setCard,
	rail,
	setRail,
	hoverTheme,
	setHoverTheme,
}: {
	analysis: AnalysisContent;
	theme: ThemeConfig;
	card: number;
	setCard: (index: number) => void;
	rail: DeckRail;
	setRail: (rail: DeckRail) => void;
	hoverTheme: number | null;
	setHoverTheme: (index: number | null) => void;
}) {
	const headline = analysis.headline;
	const compoundMood = analysis.compound_mood;
	const moodDescription = analysis.mood_description;
	const interpretation = analysis.interpretation;
	const themes = analysis.themes ?? [];
	const journey = analysis.journey ?? [];
	const keyLines = analysis.key_lines ?? [];
	const sonicTexture = analysis.sonic_texture;
	const max = Math.max(keyLines.length - 1, 0);
	const safeCard = Math.min(card, max);
	const activeLine = keyLines[safeCard];
	const activeTheme =
		hoverTheme != null
			? themes[hoverTheme]
			: themes[safeCard % Math.max(themes.length, 1)];
	const activeJourney = journey[safeCard % Math.max(journey.length, 1)];

	const move = (delta: 1 | -1) => {
		const next = Math.max(0, Math.min(safeCard + delta, max));
		setCard(next);
	};

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
					{compoundMood ?? "key lyrics"}
				</span>
			</div>

			<div
				style={{
					display: "grid",
					gridTemplateColumns: "1fr 104px",
					gap: 18,
					alignItems: "stretch",
				}}
			>
				<div
					style={{
						minHeight: 330,
						border: `1px solid ${theme.border}`,
						borderRadius: 2,
						background: theme.surface,
						padding: 20,
						display: "flex",
						flexDirection: "column",
						justifyContent: "space-between",
					}}
				>
					{activeLine && (
						<div
							key={`${activeLine.line}-${safeCard}`}
							style={{ animation: "hearted-push-up 220ms ease forwards" }}
						>
							<p
								style={{
									fontFamily: fonts.display,
									fontStyle: "italic",
									fontSize: 30,
									lineHeight: 1.18,
									color: theme.text,
									margin: 0,
								}}
							>
								&ldquo;{activeLine.line}&rdquo;
							</p>
							<p
								style={{
									fontFamily: fonts.body,
									fontSize: 14,
									lineHeight: 1.65,
									color: theme.textMuted,
									margin: "18px 0 0",
								}}
							>
								{activeLine.insight}
							</p>
						</div>
					)}
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							gap: 12,
							borderTop: `1px solid ${theme.border}`,
							paddingTop: 14,
						}}
					>
						<button
							type="button"
							onClick={() => move(-1)}
							disabled={safeCard === 0}
							style={{
								background: "transparent",
								border: `1px solid ${theme.border}`,
								borderRadius: 2,
								color: safeCard === 0 ? theme.border : theme.textMuted,
								cursor: safeCard === 0 ? "default" : "pointer",
								fontFamily: fonts.body,
								fontSize: 12,
								padding: "6px 8px",
							}}
						>
							back
						</button>
						<span
							style={{
								fontFamily: fonts.body,
								fontSize: 11,
								color: theme.textMuted,
							}}
						>
							{safeCard + 1} / {Math.max(keyLines.length, 1)}
						</span>
						<button
							type="button"
							onClick={() => move(1)}
							disabled={safeCard === max}
							style={{
								background: "transparent",
								border: `1px solid ${theme.border}`,
								borderRadius: 2,
								color: safeCard === max ? theme.border : theme.textMuted,
								cursor: safeCard === max ? "default" : "pointer",
								fontFamily: fonts.body,
								fontSize: 12,
								padding: "6px 8px",
							}}
						>
							next
						</button>
					</div>
				</div>

				<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
					{(["line", "theme", "journey"] as DeckRail[]).map((item) => (
						<button
							key={item}
							type="button"
							onClick={() => setRail(item)}
							style={{
								textAlign: "left",
								background: rail === item ? theme.primary : "transparent",
								border: `1px solid ${rail === item ? theme.primary : theme.border}`,
								borderRadius: 2,
								color: rail === item ? theme.textOnPrimary : theme.textMuted,
								cursor: "pointer",
								fontFamily: fonts.body,
								fontSize: 10,
								letterSpacing: "0.08em",
								textTransform: "uppercase",
								padding: "8px 7px",
							}}
						>
							{item}
						</button>
					))}
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: 5,
							marginTop: 8,
						}}
					>
						{keyLines.map((line, index) => (
							<button
								key={`${line.line}-dot-${index}`}
								type="button"
								onClick={() => setCard(index)}
								style={{
									height: 18,
									background:
										safeCard === index ? theme.primary : "transparent",
									border: `1px solid ${safeCard === index ? theme.primary : theme.border}`,
									borderRadius: 1,
									cursor: "pointer",
								}}
								aria-label={`Line ${index + 1}`}
							/>
						))}
					</div>
				</div>
			</div>

			<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
				<div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 16 }}>
					{rail === "line" && interpretation && (
						<p
							style={{
								fontFamily: fonts.body,
								fontSize: 14,
								lineHeight: 1.65,
								color: theme.textMuted,
								margin: 0,
							}}
						>
							{interpretation}
						</p>
					)}
					{rail === "theme" && (
						<div
							style={{ display: "flex", flexDirection: "column", gap: 10 }}
							onMouseLeave={() => setHoverTheme(null)}
						>
							{themes.map((item, index) => (
								<button
									key={`${item.name}-${index}`}
									type="button"
									onMouseEnter={() => setHoverTheme(index)}
									onClick={() =>
										setHoverTheme(hoverTheme === index ? null : index)
									}
									style={{
										textAlign: "left",
										background:
											activeTheme?.name === item.name
												? theme.surface
												: "transparent",
										border: `1px solid ${activeTheme?.name === item.name ? theme.primary : theme.border}`,
										borderRadius: 2,
										color:
											activeTheme?.name === item.name
												? theme.text
												: theme.textMuted,
										cursor: "pointer",
										fontFamily: fonts.display,
										fontSize: 17,
										padding: "8px 10px",
									}}
								>
									{item.name}
								</button>
							))}
						</div>
					)}
					{rail === "journey" && activeJourney && (
						<div>
							<div
								style={{
									fontFamily: fonts.display,
									fontSize: 24,
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
									lineHeight: 1.55,
									color: theme.textMuted,
									margin: "8px 0 0",
								}}
							>
								{activeJourney.description}
							</p>
						</div>
					)}
				</div>
				<div
					style={{
						borderTop: `1px solid ${theme.border}`,
						paddingTop: 16,
						display: "flex",
						flexDirection: "column",
						gap: 12,
					}}
				>
					{activeTheme && (
						<p
							style={{
								fontFamily: fonts.body,
								fontSize: 13,
								lineHeight: 1.55,
								color: theme.textMuted,
								margin: 0,
							}}
						>
							{activeTheme.description}
						</p>
					)}
					{moodDescription && (
						<p
							style={{
								fontFamily: fonts.body,
								fontStyle: "italic",
								fontSize: 13,
								lineHeight: 1.55,
								color: theme.textMuted,
								margin: 0,
							}}
						>
							{moodDescription}
						</p>
					)}
					{sonicTexture && (
						<p
							style={{
								fontFamily: fonts.body,
								fontSize: 12,
								lineHeight: 1.55,
								color: theme.textMuted,
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
