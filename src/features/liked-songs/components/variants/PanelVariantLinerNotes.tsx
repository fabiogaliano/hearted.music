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

type Fold = "front" | "inside" | "back";

export function PanelVariantLinerNotes({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis;
	const [fold, setFold] = useState<Fold>("front");
	const [hoveredLine, setHoveredLine] = useState<number | null>(null);
	const [openTheme, setOpenTheme] = useState<number | null>(null);

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
					<LinerBody
						analysis={analysis}
						theme={theme}
						fold={fold}
						setFold={setFold}
						hoveredLine={hoveredLine}
						setHoveredLine={setHoveredLine}
						openTheme={openTheme}
						setOpenTheme={setOpenTheme}
					/>
				)}
			</div>
		</VariantShell>
	);
}

function LinerBody({
	analysis,
	theme,
	fold,
	setFold,
	hoveredLine,
	setHoveredLine,
	openTheme,
	setOpenTheme,
}: {
	analysis: AnalysisContent;
	theme: ThemeConfig;
	fold: Fold;
	setFold: (fold: Fold) => void;
	hoveredLine: number | null;
	setHoveredLine: (index: number | null) => void;
	openTheme: number | null;
	setOpenTheme: (index: number | null) => void;
}) {
	const headline = analysis.headline;
	const compoundMood = analysis.compound_mood;
	const moodDescription = analysis.mood_description;
	const interpretation = analysis.interpretation;
	const themes = analysis.themes ?? [];
	const journey = analysis.journey ?? [];
	const keyLines = analysis.key_lines ?? [];
	const sonicTexture = analysis.sonic_texture;
	const folds: Fold[] = ["front", "inside", "back"];

	return (
		<>
			<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
				<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
					{folds.map((item) => (
						<button
							key={item}
							type="button"
							onClick={() => setFold(item)}
							style={{
								background: fold === item ? theme.primary : "transparent",
								border: `1px solid ${fold === item ? theme.primary : theme.border}`,
								borderRadius: 2,
								color: fold === item ? theme.textOnPrimary : theme.textMuted,
								cursor: "pointer",
								fontFamily: fonts.body,
								fontSize: 10,
								letterSpacing: "0.08em",
								textTransform: "uppercase",
								padding: "6px 8px",
							}}
						>
							{item}
						</button>
					))}
				</div>
			</div>

			<div
				style={{
					border: `1px solid ${theme.border}`,
					borderRadius: 2,
					background: theme.surface,
					minHeight: 390,
				}}
			>
				{fold === "front" && (
					<div
						style={{
							padding: 20,
							display: "grid",
							gridTemplateColumns: "1fr 88px",
							gap: 18,
						}}
					>
						<div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
							{compoundMood && (
								<div
									style={{
										fontFamily: fonts.display,
										fontSize: 34,
										fontStyle: "italic",
										color: theme.text,
										lineHeight: 1,
									}}
								>
									{compoundMood}
								</div>
							)}
							{moodDescription && (
								<p
									style={{
										fontFamily: fonts.body,
										fontSize: 14,
										fontStyle: "italic",
										lineHeight: 1.65,
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
										fontSize: 14,
										lineHeight: 1.65,
										color: theme.textMuted,
										margin: 0,
									}}
								>
									{interpretation}
								</p>
							)}
						</div>
						<div
							style={{
								borderLeft: `1px solid ${theme.border}`,
								paddingLeft: 14,
								display: "flex",
								flexDirection: "column",
								gap: 10,
							}}
						>
							{themes.map((item, index) => (
								<button
									key={`${item.name}-${index}`}
									type="button"
									onClick={() =>
										setOpenTheme(openTheme === index ? null : index)
									}
									style={{
										textAlign: "left",
										background: "transparent",
										border: "none",
										padding: 0,
										color:
											openTheme === index ? theme.primary : theme.textMuted,
										cursor: "pointer",
										fontFamily: fonts.body,
										fontSize: 11,
										lineHeight: 1.35,
									}}
								>
									{item.name}
								</button>
							))}
						</div>
						{openTheme != null && themes[openTheme] && (
							<p
								style={{
									gridColumn: "1 / -1",
									fontFamily: fonts.body,
									fontSize: 12,
									lineHeight: 1.55,
									color: theme.textMuted,
									paddingTop: 16,
									borderTop: `1px solid ${theme.border}`,
									margin: 0,
								}}
							>
								{themes[openTheme]?.description}
							</p>
						)}
					</div>
				)}

				{fold === "inside" && (
					<div
						style={{
							padding: 20,
							display: "grid",
							gridTemplateColumns: "1fr 1fr",
							gap: 18,
						}}
					>
						<div
							style={{ display: "flex", flexDirection: "column", gap: 14 }}
							onMouseLeave={() => setHoveredLine(null)}
						>
							{keyLines.map((item, index) => {
								const active = hoveredLine === index;
								return (
									<div
										key={`${item.line}-${index}`}
										onMouseEnter={() => setHoveredLine(index)}
										style={{
											paddingBottom: 14,
											borderBottom: `1px solid ${theme.border}`,
										}}
									>
										<p
											style={{
												fontFamily: fonts.display,
												fontSize: 16,
												fontStyle: "italic",
												lineHeight: 1.45,
												color: active ? theme.text : theme.textMuted,
												margin: 0,
												transition: "color 180ms ease",
											}}
										>
											&ldquo;{item.line}&rdquo;
										</p>
										<div
											style={{
												maxHeight: active ? 110 : 0,
												opacity: active ? 1 : 0,
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
													margin: "6px 0 0",
												}}
											>
												{item.insight}
											</p>
										</div>
									</div>
								);
							})}
						</div>
						<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
							{journey.map((step, index) => (
								<div
									key={`${step.section}-${index}`}
									style={{
										display: "grid",
										gridTemplateColumns: "54px 1fr",
										gap: 10,
									}}
								>
									<span
										style={{
											fontFamily: fonts.body,
											fontSize: 9,
											textTransform: "uppercase",
											letterSpacing: "0.08em",
											color: theme.primary,
										}}
									>
										{step.section}
									</span>
									<div>
										<div
											style={{
												fontFamily: fonts.display,
												fontSize: 16,
												fontStyle: "italic",
												color: theme.text,
											}}
										>
											{step.mood}
										</div>
										<p
											style={{
												fontFamily: fonts.body,
												fontSize: 12,
												lineHeight: 1.45,
												color: theme.textMuted,
												margin: "3px 0 0",
											}}
										>
											{step.description}
										</p>
									</div>
								</div>
							))}
						</div>
					</div>
				)}

				{fold === "back" && (
					<div
						style={{
							padding: 20,
							display: "flex",
							flexDirection: "column",
							gap: 18,
						}}
					>
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
						<div
							style={{
								display: "grid",
								gridTemplateColumns: "repeat(3, 1fr)",
								gap: 8,
							}}
						>
							{themes.slice(0, 6).map((item, index) => (
								<div
									key={`${item.name}-back-${index}`}
									style={{
										borderTop: `1px solid ${theme.border}`,
										paddingTop: 10,
									}}
								>
									<div
										style={{
											fontFamily: fonts.display,
											fontSize: 18,
											color: theme.text,
										}}
									>
										{item.name}
									</div>
									<p
										style={{
											fontFamily: fonts.body,
											fontSize: 11,
											lineHeight: 1.45,
											color: theme.textMuted,
											margin: "4px 0 0",
										}}
									>
										{item.description}
									</p>
								</div>
							))}
						</div>
					</div>
				)}
			</div>
		</>
	);
}
