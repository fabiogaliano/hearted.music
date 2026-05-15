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

type RibbonMode = "arc" | "themes" | "lyrics";

export function PanelVariantMotionRibbon({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis;
	const [step, setStep] = useState(0);
	const [mode, setMode] = useState<RibbonMode>("arc");
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
					<RibbonBody
						analysis={analysis}
						theme={theme}
						step={step}
						setStep={setStep}
						mode={mode}
						setMode={setMode}
						hoverTheme={hoverTheme}
						setHoverTheme={setHoverTheme}
					/>
				)}
			</div>
		</VariantShell>
	);
}

function RibbonBody({
	analysis,
	theme,
	step,
	setStep,
	mode,
	setMode,
	hoverTheme,
	setHoverTheme,
}: {
	analysis: AnalysisContent;
	theme: ThemeConfig;
	step: number;
	setStep: (step: number) => void;
	mode: RibbonMode;
	setMode: (mode: RibbonMode) => void;
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
	const max = Math.max(journey.length - 1, 0);
	const safeStep = Math.min(step, max);
	const activeJourney = journey[safeStep];
	const activeLine =
		keyLines.length > 0 ? keyLines[safeStep % keyLines.length] : undefined;
	const activeTheme =
		hoverTheme != null
			? themes[hoverTheme]
			: themes[safeStep % Math.max(themes.length, 1)];

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
				<div
					style={{ display: "flex", justifyContent: "space-between", gap: 16 }}
				>
					<span
						style={{
							fontFamily: fonts.body,
							fontSize: 11,
							letterSpacing: "0.08em",
							textTransform: "uppercase",
							color: theme.primary,
						}}
					>
						{compoundMood ?? "motion ribbon"}
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
			</div>

			<div
				style={{
					borderTop: `1px solid ${theme.border}`,
					borderBottom: `1px solid ${theme.border}`,
					padding: "20px 0",
					display: "flex",
					flexDirection: "column",
					gap: 18,
				}}
			>
				<div
					style={{ height: 148, display: "flex", alignItems: "end", gap: 5 }}
				>
					{journey.map((item, index) => {
						const active = safeStep === index;
						const height =
							42 + ((index + 1) / Math.max(journey.length, 1)) * 82;
						return (
							<button
								key={`${item.section}-${index}`}
								type="button"
								onMouseEnter={() => setStep(index)}
								onClick={() => setStep(index)}
								style={{
									flex: 1,
									height,
									transform: active ? "translateY(-8px)" : "translateY(0)",
									background: active
										? theme.primary
										: `color-mix(in srgb, ${theme.primary} 24%, ${theme.bg})`,
									border: `1px solid ${active ? theme.primary : theme.border}`,
									borderRadius: 1,
									cursor: "pointer",
									transition: "transform 220ms ease, background 180ms ease",
									display: "flex",
									alignItems: "end",
									justifyContent: "center",
									padding: 4,
								}}
								aria-label={item.section}
							>
								<span
									style={{
										writingMode: "vertical-rl",
										transform: "rotate(180deg)",
										fontFamily: fonts.body,
										fontSize: 9,
										color: active ? theme.textOnPrimary : theme.textMuted,
									}}
								>
									{item.section}
								</span>
							</button>
						);
					})}
				</div>
				<input
					type="range"
					min={0}
					max={max}
					value={safeStep}
					onChange={(event) => setStep(Number(event.currentTarget.value))}
					aria-label="Move through the ribbon"
					style={{ width: "100%", accentColor: theme.primary }}
				/>
				{activeJourney && (
					<div
						key={`${activeJourney.section}-${safeStep}`}
						style={{ animation: "hearted-slide-fwd 200ms ease forwards" }}
					>
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
								lineHeight: 1.6,
								color: theme.textMuted,
								margin: "6px 0 0",
							}}
						>
							{activeJourney.description}
						</p>
					</div>
				)}
			</div>

			<div style={{ display: "flex", gap: 8 }}>
				{(["arc", "themes", "lyrics"] as RibbonMode[]).map((item) => (
					<button
						key={item}
						type="button"
						onClick={() => setMode(item)}
						style={{
							background: mode === item ? theme.primary : "transparent",
							border: `1px solid ${mode === item ? theme.primary : theme.border}`,
							borderRadius: 2,
							color: mode === item ? theme.textOnPrimary : theme.textMuted,
							cursor: "pointer",
							fontFamily: fonts.body,
							fontSize: 11,
							padding: "6px 9px",
						}}
					>
						{item}
					</button>
				))}
			</div>

			<div
				style={{
					minHeight: 240,
					display: "grid",
					gridTemplateColumns: "1fr 1fr",
					gap: 16,
				}}
			>
				{mode === "arc" && (
					<>
						<div>
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
							{interpretation && (
								<p
									style={{
										fontFamily: fonts.body,
										fontSize: 13,
										lineHeight: 1.6,
										color: theme.textMuted,
										margin: "14px 0 0",
									}}
								>
									{interpretation}
								</p>
							)}
						</div>
						<div>
							{sonicTexture && (
								<p
									style={{
										fontFamily: fonts.body,
										fontSize: 13,
										lineHeight: 1.6,
										color: theme.textMuted,
										margin: 0,
									}}
								>
									{sonicTexture}
								</p>
							)}
						</div>
					</>
				)}
				{mode === "themes" && (
					<>
						<div
							style={{ display: "flex", flexDirection: "column", gap: 8 }}
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
										fontSize: 18,
										padding: "8px 10px",
									}}
								>
									{item.name}
								</button>
							))}
						</div>
						<div>
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
						</div>
					</>
				)}
				{mode === "lyrics" && (
					<>
						<div>
							{activeLine && (
								<blockquote
									style={{
										margin: 0,
										paddingLeft: 12,
										borderLeft: `1px solid ${theme.primary}`,
									}}
								>
									<p
										style={{
											fontFamily: fonts.display,
											fontSize: 22,
											fontStyle: "italic",
											lineHeight: 1.35,
											color: theme.text,
											margin: 0,
										}}
									>
										&ldquo;{activeLine.line}&rdquo;
									</p>
									<p
										style={{
											fontFamily: fonts.body,
											fontSize: 13,
											lineHeight: 1.55,
											color: theme.textMuted,
											margin: "8px 0 0",
										}}
									>
										{activeLine.insight}
									</p>
								</blockquote>
							)}
						</div>
						<div>
							{keyLines.map((item, index) => (
								<button
									key={`${item.line}-jump-${index}`}
									type="button"
									onClick={() => setStep(index % Math.max(journey.length, 1))}
									style={{
										width: "100%",
										textAlign: "left",
										background: "transparent",
										border: "none",
										borderBottom: `1px solid ${theme.border}`,
										color: theme.textMuted,
										cursor: "pointer",
										fontFamily: fonts.body,
										fontSize: 12,
										padding: "7px 0",
									}}
								>
									{item.line}
								</button>
							))}
						</div>
					</>
				)}
			</div>
		</>
	);
}
