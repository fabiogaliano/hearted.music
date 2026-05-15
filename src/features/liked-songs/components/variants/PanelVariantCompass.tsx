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

type CompassPanel = "mood" | "themes" | "lines" | "journey" | "sound";

const PANEL_COPY: Record<CompassPanel, string> = {
	mood: "what it feels like",
	themes: "what it's about",
	lines: "key lyrics",
	journey: "how it moves",
	sound: "how it sounds",
};

function EmptyState({ theme }: { theme: ThemeConfig }) {
	return (
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
	);
}

export function PanelVariantCompass({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis;
	const [activePanel, setActivePanel] = useState<CompassPanel>("mood");
	const [hoverPanel, setHoverPanel] = useState<CompassPanel | null>(null);

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
					<EmptyState theme={theme} />
				) : (
					<CompassBody
						analysis={analysis}
						theme={theme}
						activePanel={activePanel}
						hoverPanel={hoverPanel}
						onHover={setHoverPanel}
						onSelect={setActivePanel}
					/>
				)}
			</div>
		</VariantShell>
	);
}

function CompassBody({
	analysis,
	theme,
	activePanel,
	hoverPanel,
	onHover,
	onSelect,
}: {
	analysis: AnalysisContent;
	theme: ThemeConfig;
	activePanel: CompassPanel;
	hoverPanel: CompassPanel | null;
	onHover: (panel: CompassPanel | null) => void;
	onSelect: (panel: CompassPanel) => void;
}) {
	const headline = analysis.headline;
	const compoundMood = analysis.compound_mood;
	const moodDescription = analysis.mood_description;
	const interpretation = analysis.interpretation;
	const themes = analysis.themes ?? [];
	const journey = analysis.journey ?? [];
	const keyLines = analysis.key_lines ?? [];
	const sonicTexture = analysis.sonic_texture;
	const preview = hoverPanel ? PANEL_COPY[hoverPanel] : PANEL_COPY[activePanel];
	const panels = Object.keys(PANEL_COPY) as CompassPanel[];

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
							fontSize: 11,
							letterSpacing: "0.08em",
							textTransform: "uppercase",
							color: theme.primary,
						}}
					>
						{compoundMood ?? "read deeper"}
					</span>
					<span
						style={{
							fontFamily: fonts.body,
							fontSize: 11,
							color: theme.textMuted,
						}}
					>
						{preview}
					</span>
				</div>
			</div>

			<div
				style={{
					position: "relative",
					minHeight: 226,
					borderTop: `1px solid ${theme.border}`,
					borderBottom: `1px solid ${theme.border}`,
					padding: "24px 0",
				}}
			>
				<div
					style={{
						position: "absolute",
						left: "50%",
						top: "50%",
						width: 150,
						height: 150,
						transform: "translate(-50%, -50%)",
						border: `1px solid ${theme.border}`,
						borderRadius: "50%",
					}}
				/>
				<div
					style={{
						position: "absolute",
						left: "50%",
						top: "50%",
						width: 72,
						height: 72,
						transform: "translate(-50%, -50%)",
						border: `1px solid ${theme.primary}`,
						borderRadius: "50%",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						fontFamily: fonts.display,
						fontSize: 18,
						fontStyle: "italic",
						color: theme.text,
					}}
				>
					{activePanel}
				</div>
				{panels.map((panel, index) => {
					const angle = -90 + index * 72;
					const active = activePanel === panel;
					const hovered = hoverPanel === panel;
					return (
						<button
							key={panel}
							type="button"
							onClick={() => onSelect(panel)}
							onMouseEnter={() => onHover(panel)}
							onMouseLeave={() => onHover(null)}
							style={{
								position: "absolute",
								left: "50%",
								top: "50%",
								transform: `rotate(${angle}deg) translate(98px) rotate(${-angle}deg)`,
								transformOrigin: "0 0",
								background: active ? theme.primary : theme.surface,
								color: active ? theme.textOnPrimary : theme.text,
								border: `1px solid ${active || hovered ? theme.primary : theme.border}`,
								borderRadius: 2,
								padding: "7px 9px",
								fontFamily: fonts.body,
								fontSize: 10,
								letterSpacing: "0.08em",
								textTransform: "uppercase",
								cursor: "pointer",
								transition:
									"background 180ms ease, color 180ms ease, border-color 180ms ease",
							}}
						>
							{panel}
						</button>
					);
				})}
			</div>

			<div style={{ minHeight: 240 }}>
				{activePanel === "mood" && (
					<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
						{moodDescription && (
							<p
								style={{
									fontFamily: fonts.body,
									fontSize: 15,
									fontStyle: "italic",
									lineHeight: 1.6,
									color: theme.textMuted,
									margin: 0,
								}}
							>
								{moodDescription}
							</p>
						)}
						{interpretation && <BodyCopy text={interpretation} theme={theme} />}
					</div>
				)}

				{activePanel === "themes" && (
					<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
						{themes.map((item, index) => (
							<div
								key={`${item.name}-${index}`}
								style={{
									display: "grid",
									gridTemplateColumns: "92px 1fr",
									gap: 12,
									paddingTop: index === 0 ? 0 : 12,
									borderTop: index === 0 ? "none" : `1px solid ${theme.border}`,
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
										lineHeight: 1.5,
										color: theme.textMuted,
										margin: 0,
									}}
								>
									{item.description}
								</p>
							</div>
						))}
					</div>
				)}

				{activePanel === "lines" && (
					<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
										fontSize: 17,
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
				)}

				{activePanel === "journey" && (
					<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
						{journey.map((step, index) => (
							<div
								key={`${step.section}-${index}`}
								style={{
									display: "grid",
									gridTemplateColumns: "64px 1fr",
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
											fontSize: 17,
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
				)}

				{activePanel === "sound" && sonicTexture && (
					<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
						<BodyCopy text={sonicTexture} theme={theme} />
						<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
							{themes.map((item) => (
								<span
									key={item.name}
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
			</div>
		</>
	);
}

function BodyCopy({ text, theme }: { text: string; theme: ThemeConfig }) {
	return (
		<p
			style={{
				fontFamily: fonts.body,
				fontSize: 14,
				lineHeight: 1.65,
				color: theme.textMuted,
				margin: 0,
			}}
		>
			{text}
		</p>
	);
}
