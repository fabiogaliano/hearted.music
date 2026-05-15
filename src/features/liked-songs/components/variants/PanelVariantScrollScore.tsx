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

type ScoreSection = "mood" | "themes" | "journey" | "lyrics" | "sound";

export function PanelVariantScrollScore({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis;
	const [hovered, setHovered] = useState<ScoreSection | null>(null);

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
					<ScoreBody
						analysis={analysis}
						theme={theme}
						hovered={hovered}
						setHovered={setHovered}
					/>
				)}
			</div>
		</VariantShell>
	);
}

function ScoreBody({
	analysis,
	theme,
	hovered,
	setHovered,
}: {
	analysis: AnalysisContent;
	theme: ThemeConfig;
	hovered: ScoreSection | null;
	setHovered: (section: ScoreSection | null) => void;
}) {
	const headline = analysis.headline;
	const compoundMood = analysis.compound_mood;
	const moodDescription = analysis.mood_description;
	const interpretation = analysis.interpretation;
	const themes = analysis.themes ?? [];
	const journey = analysis.journey ?? [];
	const keyLines = analysis.key_lines ?? [];
	const sonicTexture = analysis.sonic_texture;
	const sections: Array<{ id: ScoreSection; label: string }> = [
		{ id: "mood", label: "mood" },
		{ id: "themes", label: "about" },
		{ id: "journey", label: "movement" },
		{ id: "lyrics", label: "lyrics" },
		{ id: "sound", label: "sound" },
	];

	const scrollTo = (id: ScoreSection) => {
		const element = document.getElementById(`scroll-score-${id}`);
		element?.scrollIntoView({ behavior: "smooth", block: "start" });
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
					display: "grid",
					gridTemplateColumns: "94px 1fr",
					gap: 18,
					alignItems: "start",
				}}
			>
				<nav
					style={{
						position: "sticky",
						top: 18,
						display: "flex",
						flexDirection: "column",
						gap: 8,
					}}
					onMouseLeave={() => setHovered(null)}
					aria-label="Song score sections"
				>
					{sections.map((section) => (
						<button
							key={section.id}
							type="button"
							onClick={() => scrollTo(section.id)}
							onMouseEnter={() => setHovered(section.id)}
							style={{
								textAlign: "left",
								background:
									hovered === section.id ? theme.surface : "transparent",
								border: `1px solid ${hovered === section.id ? theme.primary : theme.border}`,
								borderRadius: 2,
								color: hovered === section.id ? theme.text : theme.textMuted,
								cursor: "pointer",
								fontFamily: fonts.body,
								fontSize: 10,
								letterSpacing: "0.08em",
								textTransform: "uppercase",
								padding: "8px 7px",
							}}
						>
							{section.label}
						</button>
					))}
					<div
						style={{
							marginTop: 10,
							height: 120,
							borderLeft: `1px solid ${theme.border}`,
							display: "flex",
							flexDirection: "column",
							justifyContent: "space-between",
							paddingLeft: 8,
						}}
					>
						{journey.slice(0, 6).map((step, index) => (
							<span
								key={`${step.section}-tick-${index}`}
								style={{
									fontFamily: fonts.body,
									fontSize: 9,
									color: theme.textMuted,
								}}
							>
								{step.section}
							</span>
						))}
					</div>
				</nav>

				<div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
					<section
						id="scroll-score-mood"
						style={{
							scrollMarginTop: 18,
							minHeight: 220,
							borderTop: `1px solid ${theme.border}`,
							paddingTop: 18,
						}}
					>
						{compoundMood && (
							<h2
								style={{
									fontFamily: fonts.display,
									fontSize: 34,
									fontStyle: "italic",
									fontWeight: 400,
									color: theme.text,
									margin: 0,
								}}
							>
								{compoundMood}
							</h2>
						)}
						{moodDescription && (
							<p
								style={{
									fontFamily: fonts.body,
									fontStyle: "italic",
									fontSize: 14,
									lineHeight: 1.65,
									color: theme.textMuted,
									margin: "14px 0 0",
								}}
							>
								{moodDescription}
							</p>
						)}
					</section>

					<section
						id="scroll-score-themes"
						style={{
							scrollMarginTop: 18,
							minHeight: 260,
							borderTop: `1px solid ${theme.border}`,
							paddingTop: 18,
						}}
					>
						<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
							{themes.map((item, index) => (
								<div
									key={`${item.name}-${index}`}
									style={{
										display: "grid",
										gridTemplateColumns: "84px 1fr",
										gap: 12,
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
											fontSize: 13,
											lineHeight: 1.55,
											color: theme.textMuted,
											margin: 0,
										}}
									>
										{item.description}
									</p>
								</div>
							))}
						</div>
					</section>

					<section
						id="scroll-score-journey"
						style={{
							scrollMarginTop: 18,
							minHeight: 320,
							borderTop: `1px solid ${theme.border}`,
							paddingTop: 18,
						}}
					>
						<div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
							{journey.map((step, index) => (
								<div
									key={`${step.section}-${index}`}
									style={{
										display: "grid",
										gridTemplateColumns: "54px 1fr",
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
										{step.section}
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
											{step.mood}
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
											{step.description}
										</p>
									</div>
								</div>
							))}
						</div>
					</section>

					<section
						id="scroll-score-lyrics"
						style={{
							scrollMarginTop: 18,
							minHeight: 300,
							borderTop: `1px solid ${theme.border}`,
							paddingTop: 18,
						}}
					>
						<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
							{keyLines.map((line, index) => (
								<blockquote
									key={`${line.line}-${index}`}
									style={{
										margin: 0,
										paddingLeft: 12,
										borderLeft: `1px solid ${theme.primary}`,
									}}
								>
									<p
										style={{
											fontFamily: fonts.display,
											fontSize: 18,
											fontStyle: "italic",
											lineHeight: 1.45,
											color: theme.text,
											margin: 0,
										}}
									>
										&ldquo;{line.line}&rdquo;
									</p>
									<p
										style={{
											fontFamily: fonts.body,
											fontSize: 12,
											lineHeight: 1.5,
											color: theme.textMuted,
											margin: "6px 0 0",
										}}
									>
										{line.insight}
									</p>
								</blockquote>
							))}
						</div>
					</section>

					<section
						id="scroll-score-sound"
						style={{
							scrollMarginTop: 18,
							minHeight: 240,
							borderTop: `1px solid ${theme.border}`,
							paddingTop: 18,
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
								display: "flex",
								flexWrap: "wrap",
								gap: 6,
								marginTop: 16,
							}}
						>
							{themes.map((item) => (
								<span
									key={`${item.name}-sound`}
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
					</section>
				</div>
			</div>
		</>
	);
}
