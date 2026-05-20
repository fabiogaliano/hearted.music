import { useState } from "react";
import type { AnalysisContent, LikedSong } from "@/features/liked-songs/types";
import { fonts } from "@/lib/theme/fonts";
import { useThemeWithOverride } from "@/lib/theme/ThemeHueProvider";
import type { ThemeConfig } from "@/lib/theme/types";
import {
	GenreRow,
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

type Section = "headline" | "mood" | "themes" | "lines" | "journey" | "sound";

export function PanelVariantTwoPane({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis as AnalysisContent | undefined;
	const [section, setSection] = useState<Section>("headline");

	const nav = analysis
		? [
				analysis.headline ? { id: "headline" as Section, label: "Headline", count: null } : null,
				analysis.compound_mood || analysis.mood_description
					? { id: "mood" as Section, label: "Mood", count: null }
					: null,
				analysis.themes?.length
					? { id: "themes" as Section, label: "Themes", count: analysis.themes.length }
					: null,
				analysis.key_lines?.length
					? { id: "lines" as Section, label: "Lines", count: analysis.key_lines.length }
					: null,
				analysis.journey?.length
					? { id: "journey" as Section, label: "Journey", count: analysis.journey.length }
					: null,
				analysis.sonic_texture ? { id: "sound" as Section, label: "Sound", count: null } : null,
			].filter((n): n is { id: Section; label: string; count: number | null } => n !== null)
		: [];

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
					gap: 22,
				}}
			>
				<GenreRow genres={song.track.genres} theme={theme} />

				{!analysis ? (
					<EmptyState theme={theme} />
				) : (
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "120px 1fr",
							gap: 22,
							alignItems: "start",
						}}
					>
						<nav
							style={{
								display: "flex",
								flexDirection: "column",
								gap: 0,
								position: "sticky",
								top: 16,
							}}
							aria-label="Section navigation"
						>
							{nav.map((n) => {
								const isActive = section === n.id;
								return (
									<button
										key={n.id}
										type="button"
										onClick={() => setSection(n.id)}
										style={{
											display: "flex",
											alignItems: "baseline",
											justifyContent: "space-between",
											gap: 8,
											padding: "8px 10px 8px 12px",
											background: "transparent",
											border: "none",
											borderLeft: `2px solid ${isActive ? theme.primary : "transparent"}`,
											cursor: "pointer",
											textAlign: "left",
											transition: "border-color 160ms ease",
										}}
									>
										<span
											style={{
												fontFamily: fonts.body,
												fontSize: 13,
												color: isActive ? theme.text : theme.textMuted,
												fontWeight: isActive ? 500 : 400,
											}}
										>
											{n.label}
										</span>
										{n.count !== null && (
											<span
												style={{
													fontFamily: fonts.body,
													fontSize: 10,
													color: theme.textMuted,
													opacity: 0.7,
												}}
											>
												{n.count}
											</span>
										)}
									</button>
								);
							})}
						</nav>

						<div
							style={{ display: "flex", flexDirection: "column", gap: 16 }}
							key={section}
						>
							<h3
								style={{
									fontFamily: fonts.body,
									fontSize: 10,
									fontWeight: 500,
									letterSpacing: "0.1em",
									textTransform: "uppercase",
									color: theme.textMuted,
									margin: 0,
								}}
							>
								{nav.find((n) => n.id === section)?.label}
							</h3>
							<Body section={section} analysis={analysis} theme={theme} />
						</div>
					</div>
				)}
			</div>
		</VariantShell>
	);
}

function Body({
	section,
	analysis,
	theme,
}: {
	section: Section;
	analysis: AnalysisContent;
	theme: ThemeConfig;
}) {
	if (section === "headline") {
		return (
			<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
				{analysis.headline && (
					<p
						style={{
							fontFamily: fonts.display,
							fontSize: 22,
							lineHeight: 1.3,
							color: theme.text,
							margin: 0,
						}}
					>
						{analysis.headline}
					</p>
				)}
				{analysis.interpretation && (
					<p
						style={{
							fontFamily: fonts.body,
							fontStyle: "italic",
							fontSize: 14,
							lineHeight: 1.65,
							color: theme.textMuted,
							margin: 0,
							borderLeft: `2px solid ${theme.primary}`,
							paddingLeft: 12,
						}}
					>
						{analysis.interpretation}
					</p>
				)}
			</div>
		);
	}
	if (section === "mood") {
		return (
			<MoodBlock
				compoundMood={analysis.compound_mood}
				moodDescription={analysis.mood_description}
				theme={theme}
			/>
		);
	}
	if (section === "themes" && analysis.themes?.length) {
		return (
			<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
				<ThemesInline themes={analysis.themes} theme={theme} />
				<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
					{analysis.themes.map((t, i) => (
						<div
							key={`${t.name}-${i}`}
							style={{
								paddingTop: i === 0 ? 0 : 10,
								borderTop: i === 0 ? "none" : `1px solid ${theme.border}`,
							}}
						>
							<div
								style={{
									fontFamily: fonts.display,
									fontSize: 15,
									color: theme.text,
								}}
							>
								{t.name}
							</div>
							<p
								style={{
									fontFamily: fonts.body,
									fontSize: 13,
									lineHeight: 1.55,
									color: theme.textMuted,
									margin: "3px 0 0",
								}}
							>
								{t.description}
							</p>
						</div>
					))}
				</div>
			</div>
		);
	}
	if (section === "lines" && analysis.key_lines?.length) {
		return (
			<KeyLinesDisplay
				keyLines={analysis.key_lines}
				theme={theme}
				showHeader={false}
			/>
		);
	}
	if (section === "journey" && analysis.journey?.length) {
		return <JourneyDisplay journey={analysis.journey} theme={theme} />;
	}
	if (section === "sound" && analysis.sonic_texture) {
		return (
			<p
				style={{
					fontFamily: fonts.body,
					fontSize: 14,
					lineHeight: 1.6,
					color: theme.textMuted,
					margin: 0,
				}}
			>
				{analysis.sonic_texture}
			</p>
		);
	}
	return null;
}

function EmptyState({ theme }: { theme: ThemeConfig }) {
	return (
		<p
			style={{
				fontFamily: fonts.display,
				fontSize: 22,
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
