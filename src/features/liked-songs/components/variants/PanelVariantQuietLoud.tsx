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

type LoudPanel = "themes" | "lyrics" | "journey" | "texture";

export function PanelVariantQuietLoud({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis;
	const [isLoud, setIsLoud] = useState(false);
	const [panel, setPanel] = useState<LoudPanel>("themes");
	const [hovered, setHovered] = useState<LoudPanel | null>(null);

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
					<QuietLoudBody
						analysis={analysis}
						theme={theme}
						isLoud={isLoud}
						setIsLoud={setIsLoud}
						panel={panel}
						setPanel={setPanel}
						hovered={hovered}
						setHovered={setHovered}
					/>
				)}
			</div>
		</VariantShell>
	);
}

function QuietLoudBody({
	analysis,
	theme,
	isLoud,
	setIsLoud,
	panel,
	setPanel,
	hovered,
	setHovered,
}: {
	analysis: AnalysisContent;
	theme: ThemeConfig;
	isLoud: boolean;
	setIsLoud: (value: boolean) => void;
	panel: LoudPanel;
	setPanel: (panel: LoudPanel) => void;
	hovered: LoudPanel | null;
	setHovered: (panel: LoudPanel | null) => void;
}) {
	const headline = analysis.headline;
	const compoundMood = analysis.compound_mood;
	const moodDescription = analysis.mood_description;
	const interpretation = analysis.interpretation;
	const themes = analysis.themes ?? [];
	const journey = analysis.journey ?? [];
	const keyLines = analysis.key_lines ?? [];
	const sonicTexture = analysis.sonic_texture;
	const options: LoudPanel[] = ["themes", "lyrics", "journey", "texture"];
	const previewPanel = hovered ?? panel;

	return (
		<>
			<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
				{headline && (
					<p
						style={{
							fontFamily: fonts.display,
							fontSize: 31,
							fontWeight: 400,
							lineHeight: 1.15,
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
						{compoundMood ?? "quiet first"}
					</span>
					<button
						type="button"
						onClick={() => setIsLoud(!isLoud)}
						style={{
							background: isLoud ? theme.primary : "transparent",
							border: `1px solid ${isLoud ? theme.primary : theme.border}`,
							borderRadius: 2,
							color: isLoud ? theme.textOnPrimary : theme.textMuted,
							cursor: "pointer",
							fontFamily: fonts.body,
							fontSize: 11,
							padding: "6px 9px",
						}}
					>
						{isLoud ? "make it quiet" : "open it up"}
					</button>
				</div>
			</div>

			{!isLoud ? (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 22,
						padding: "26px 0",
						borderTop: `1px solid ${theme.border}`,
						borderBottom: `1px solid ${theme.border}`,
					}}
				>
					{moodDescription && (
						<p
							style={{
								fontFamily: fonts.display,
								fontSize: 26,
								fontStyle: "italic",
								lineHeight: 1.25,
								color: theme.textMuted,
								margin: 0,
							}}
						>
							{moodDescription}
						</p>
					)}
					{/* biome-ignore lint/a11y/noStaticElementInteractions: hover-only visual effect, keyboard users interact with children directly */}
					<div
						role="presentation"
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(4, 1fr)",
							gap: 8,
						}}
						onMouseLeave={() => setHovered(null)}
					>
						{options.map((item) => (
							<button
								key={item}
								type="button"
								onMouseEnter={() => setHovered(item)}
								onClick={() => {
									setPanel(item);
									setIsLoud(true);
								}}
								style={{
									minHeight: 72,
									background:
										previewPanel === item ? theme.surface : "transparent",
									border: `1px solid ${previewPanel === item ? theme.primary : theme.border}`,
									borderRadius: 2,
									color: previewPanel === item ? theme.text : theme.textMuted,
									cursor: "pointer",
									fontFamily: fonts.body,
									fontSize: 10,
									letterSpacing: "0.08em",
									textTransform: "uppercase",
									padding: 8,
								}}
							>
								{item}
							</button>
						))}
					</div>
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
			) : (
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "112px 1fr",
						gap: 18,
						borderTop: `1px solid ${theme.border}`,
						paddingTop: 18,
					}}
				>
					<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
						{options.map((item) => (
							<button
								key={item}
								type="button"
								onMouseEnter={() => setHovered(item)}
								onMouseLeave={() => setHovered(null)}
								onClick={() => setPanel(item)}
								style={{
									textAlign: "left",
									background: panel === item ? theme.primary : "transparent",
									border: `1px solid ${panel === item ? theme.primary : theme.border}`,
									borderRadius: 2,
									color: panel === item ? theme.textOnPrimary : theme.textMuted,
									cursor: "pointer",
									fontFamily: fonts.body,
									fontSize: 11,
									padding: "8px 9px",
								}}
							>
								{item}
							</button>
						))}
					</div>
					<div
						style={{
							minHeight: 360,
							background: theme.surface,
							border: `1px solid ${theme.border}`,
							borderRadius: 2,
							padding: 18,
						}}
					>
						{panel === "themes" && (
							<ThemesPanel themes={themes} theme={theme} />
						)}
						{panel === "lyrics" && (
							<LyricsPanel keyLines={keyLines} theme={theme} />
						)}
						{panel === "journey" && (
							<JourneyPanel journey={journey} theme={theme} />
						)}
						{panel === "texture" && (
							<TexturePanel
								sonicTexture={sonicTexture}
								moodDescription={moodDescription}
								interpretation={interpretation}
								theme={theme}
							/>
						)}
					</div>
				</div>
			)}
		</>
	);
}

function ThemesPanel({
	themes,
	theme,
}: {
	themes: NonNullable<AnalysisContent["themes"]>;
	theme: ThemeConfig;
}) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
			{themes.map((item, index) => (
				<div
					key={`${item.name}-${index}`}
					style={{
						paddingBottom: 14,
						borderBottom:
							index === themes.length - 1
								? "none"
								: `1px solid ${theme.border}`,
					}}
				>
					<div
						style={{
							fontFamily: fonts.display,
							fontSize: 22,
							color: theme.text,
						}}
					>
						{item.name}
					</div>
					<p
						style={{
							fontFamily: fonts.body,
							fontSize: 13,
							lineHeight: 1.55,
							color: theme.textMuted,
							margin: "5px 0 0",
						}}
					>
						{item.description}
					</p>
				</div>
			))}
		</div>
	);
}

function LyricsPanel({
	keyLines,
	theme,
}: {
	keyLines: NonNullable<AnalysisContent["key_lines"]>;
	theme: ThemeConfig;
}) {
	const [open, setOpen] = useState(0);
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
			{keyLines.map((item, index) => (
				<button
					key={`${item.line}-${index}`}
					type="button"
					onClick={() => setOpen(open === index ? -1 : index)}
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
							color: open === index ? theme.text : theme.textMuted,
							margin: 0,
						}}
					>
						&ldquo;{item.line}&rdquo;
					</p>
					{open === index && (
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
					)}
				</button>
			))}
		</div>
	);
}

function JourneyPanel({
	journey,
	theme,
}: {
	journey: NonNullable<AnalysisContent["journey"]>;
	theme: ThemeConfig;
}) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
			{journey.map((item, index) => (
				<div
					key={`${item.section}-${index}`}
					style={{ display: "grid", gridTemplateColumns: "64px 1fr", gap: 12 }}
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
	);
}

function TexturePanel({
	sonicTexture,
	moodDescription,
	interpretation,
	theme,
}: {
	sonicTexture?: string;
	moodDescription?: string;
	interpretation?: string;
	theme: ThemeConfig;
}) {
	return (
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
	);
}
