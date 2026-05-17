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

type QuestionKey = "why" | "feel" | "words" | "moves" | "sound";

const QUESTIONS: Array<{ key: QuestionKey; label: string }> = [
	{ key: "why", label: "why did this stay?" },
	{ key: "feel", label: "what feeling is it holding?" },
	{ key: "words", label: "which lines matter?" },
	{ key: "moves", label: "where does it turn?" },
	{ key: "sound", label: "what does the room sound like?" },
];

export function PanelVariantFieldGuide({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis;
	const [active, setActive] = useState<QuestionKey>("why");
	const [hovered, setHovered] = useState<QuestionKey | null>(null);
	const [expandedLine, setExpandedLine] = useState(0);

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
					<FieldGuideBody
						analysis={analysis}
						theme={theme}
						active={active}
						setActive={setActive}
						hovered={hovered}
						setHovered={setHovered}
						expandedLine={expandedLine}
						setExpandedLine={setExpandedLine}
					/>
				)}
			</div>
		</VariantShell>
	);
}

function FieldGuideBody({
	analysis,
	theme,
	active,
	setActive,
	hovered,
	setHovered,
	expandedLine,
	setExpandedLine,
}: {
	analysis: AnalysisContent;
	theme: ThemeConfig;
	active: QuestionKey;
	setActive: (key: QuestionKey) => void;
	hovered: QuestionKey | null;
	setHovered: (key: QuestionKey | null) => void;
	expandedLine: number;
	setExpandedLine: (index: number) => void;
}) {
	const headline = analysis.headline;
	const compoundMood = analysis.compound_mood;
	const moodDescription = analysis.mood_description;
	const interpretation = analysis.interpretation;
	const themes = analysis.themes ?? [];
	const journey = analysis.journey ?? [];
	const keyLines = analysis.key_lines ?? [];
	const sonicTexture = analysis.sonic_texture;
	const preview = hovered ?? active;

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
					{compoundMood ?? "field notes"}
				</span>
			</div>

			<div
				style={{ display: "grid", gridTemplateColumns: "1fr 1.25fr", gap: 18 }}
			>
				<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
					{QUESTIONS.map((question) => {
						const selected = active === question.key;
						const peeking = preview === question.key;
						return (
							<button
								key={question.key}
								type="button"
								onClick={() => setActive(question.key)}
								onMouseEnter={() => setHovered(question.key)}
								onMouseLeave={() => setHovered(null)}
								style={{
									textAlign: "left",
									minHeight: 64,
									background: selected
										? theme.primary
										: peeking
											? theme.surface
											: "transparent",
									border: `1px solid ${selected || peeking ? theme.primary : theme.border}`,
									borderRadius: 2,
									color: selected ? theme.textOnPrimary : theme.text,
									cursor: "pointer",
									fontFamily: fonts.display,
									fontSize: 19,
									lineHeight: 1.1,
									padding: 12,
									transition: "background 180ms ease, border-color 180ms ease",
								}}
							>
								{question.label}
							</button>
						);
					})}
				</div>

				<div
					style={{
						minHeight: 420,
						border: `1px solid ${theme.border}`,
						borderRadius: 2,
						background: theme.surface,
						padding: 18,
					}}
				>
					{active === "why" && (
						<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
							{interpretation && (
								<p
									style={{
										fontFamily: fonts.body,
										fontSize: 15,
										lineHeight: 1.7,
										color: theme.textMuted,
										margin: 0,
									}}
								>
									{interpretation}
								</p>
							)}
							<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
								{themes.map((item, index) => (
									<span
										key={`${item.name}-${index}`}
										style={{
											fontFamily: fonts.body,
											fontSize: 11,
											color: theme.textMuted,
											border: `1px solid ${theme.border}`,
											borderRadius: 2,
											padding: "4px 7px",
										}}
									>
										{item.name}
									</span>
								))}
							</div>
						</div>
					)}

					{active === "feel" && (
						<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
							{compoundMood && (
								<div
									style={{
										fontFamily: fonts.display,
										fontSize: 38,
										fontStyle: "italic",
										lineHeight: 1,
										color: theme.text,
									}}
								>
									{compoundMood}
								</div>
							)}
							{moodDescription && (
								<p
									style={{
										fontFamily: fonts.body,
										fontStyle: "italic",
										fontSize: 14,
										lineHeight: 1.65,
										color: theme.textMuted,
										margin: 0,
									}}
								>
									{moodDescription}
								</p>
							)}
							{themes.map((item, index) => (
								<div
									key={`${item.name}-feel-${index}`}
									style={{
										borderTop: `1px solid ${theme.border}`,
										paddingTop: 10,
									}}
								>
									<span
										style={{
											fontFamily: fonts.display,
											fontSize: 18,
											color: theme.text,
										}}
									>
										{item.name}
									</span>
									<p
										style={{
											fontFamily: fonts.body,
											fontSize: 12,
											lineHeight: 1.5,
											color: theme.textMuted,
											margin: "4px 0 0",
										}}
									>
										{item.description}
									</p>
								</div>
							))}
						</div>
					)}

					{active === "words" && (
						<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
							{keyLines.map((item, index) => (
								<button
									key={`${item.line}-${index}`}
									type="button"
									onClick={() =>
										setExpandedLine(expandedLine === index ? -1 : index)
									}
									style={{
										textAlign: "left",
										background: "transparent",
										border: "none",
										borderBottom: `1px solid ${theme.border}`,
										padding: "0 0 12px",
										cursor: "pointer",
									}}
								>
									<p
										style={{
											fontFamily: fonts.display,
											fontSize: 18,
											fontStyle: "italic",
											lineHeight: 1.45,
											color:
												expandedLine === index ? theme.text : theme.textMuted,
											margin: 0,
										}}
									>
										&ldquo;{item.line}&rdquo;
									</p>
									<div
										style={{
											maxHeight: expandedLine === index ? 100 : 0,
											opacity: expandedLine === index ? 1 : 0,
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
								</button>
							))}
						</div>
					)}

					{active === "moves" && (
						<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
							{journey.map((item, index) => (
								<div
									key={`${item.section}-${index}`}
									style={{
										display: "grid",
										gridTemplateColumns: "58px 1fr",
										gap: 12,
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
										{item.section}
									</span>
									<div>
										<div
											style={{
												fontFamily: fonts.display,
												fontSize: 18,
												fontStyle: "italic",
												color: theme.text,
											}}
										>
											{item.mood}
										</div>
										<p
											style={{
												fontFamily: fonts.body,
												fontSize: 12,
												lineHeight: 1.5,
												color: theme.textMuted,
												margin: "4px 0 0",
											}}
										>
											{item.description}
										</p>
									</div>
								</div>
							))}
						</div>
					)}

					{active === "sound" && (
						<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
							{keyLines.slice(0, 2).map((item) => (
								<blockquote
									key={`${item.line}-sound`}
									style={{
										margin: 0,
										paddingLeft: 12,
										borderLeft: `1px solid ${theme.primary}`,
									}}
								>
									<p
										style={{
											fontFamily: fonts.display,
											fontStyle: "italic",
											fontSize: 16,
											lineHeight: 1.45,
											color: theme.text,
											margin: 0,
										}}
									>
										&ldquo;{item.line}&rdquo;
									</p>
								</blockquote>
							))}
						</div>
					)}
				</div>
			</div>
		</>
	);
}
