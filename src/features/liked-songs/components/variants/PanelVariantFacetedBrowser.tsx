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

type Facet = "all" | "mood" | "themes" | "lines" | "journey" | "sound";

const FACETS: { key: Facet; label: string }[] = [
	{ key: "all", label: "All" },
	{ key: "mood", label: "Mood" },
	{ key: "themes", label: "Themes" },
	{ key: "lines", label: "Lines" },
	{ key: "journey", label: "Journey" },
	{ key: "sound", label: "Sound" },
];

export function PanelVariantFacetedBrowser({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis as AnalysisContent | undefined;
	const [active, setActive] = useState<Facet>("all");

	const counts = analysis
		? {
				mood: analysis.compound_mood || analysis.mood_description ? 1 : 0,
				themes: analysis.themes?.length ?? 0,
				lines: analysis.key_lines?.length ?? 0,
				journey: analysis.journey?.length ?? 0,
				sound: analysis.sonic_texture ? 1 : 0,
			}
		: { mood: 0, themes: 0, lines: 0, journey: 0, sound: 0 };

	const show = (f: Facet) => active === "all" || active === f;

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
					gap: 28,
				}}
			>
				<GenreRow genres={song.track.genres} theme={theme} />

				<div
					style={{
						display: "flex",
						flexWrap: "wrap",
						gap: 6,
						borderBottom: `1px solid ${theme.border}`,
						paddingBottom: 16,
					}}
				>
					{FACETS.map((f) => {
						const total =
							f.key === "all"
								? counts.mood +
									counts.themes +
									counts.lines +
									counts.journey +
									counts.sound
								: counts[f.key];
						const isActive = active === f.key;
						return (
							<button
								key={f.key}
								type="button"
								onClick={() => setActive(f.key)}
								style={{
									fontFamily: fonts.body,
									fontSize: 11,
									letterSpacing: "0.06em",
									textTransform: "uppercase",
									padding: "5px 10px",
									borderRadius: 999,
									border: `1px solid ${isActive ? theme.primary : theme.border}`,
									background: isActive ? theme.primary : "transparent",
									color: isActive ? theme.textOnPrimary : theme.textMuted,
									cursor: "pointer",
									transition:
										"background 160ms ease, color 160ms ease, border-color 160ms ease",
								}}
							>
								{f.label}
								<span
									style={{ marginLeft: 6, opacity: isActive ? 0.85 : 0.55 }}
								>
									{total}
								</span>
							</button>
						);
					})}
				</div>

				{!analysis ? (
					<EmptyState theme={theme} />
				) : (
					<div
						style={{ display: "flex", flexDirection: "column", gap: 28 }}
						key={active}
					>
						{show("mood") &&
							(analysis.compound_mood || analysis.mood_description) && (
								<MoodBlock
									compoundMood={analysis.compound_mood}
									moodDescription={analysis.mood_description}
									theme={theme}
								/>
							)}
						{show("themes") &&
							analysis.themes &&
							analysis.themes.length > 0 && (
								<ThemesInline themes={analysis.themes} theme={theme} />
							)}
						{show("lines") &&
							analysis.key_lines &&
							analysis.key_lines.length > 0 && (
								<KeyLinesDisplay keyLines={analysis.key_lines} theme={theme} />
							)}
						{show("journey") &&
							analysis.journey &&
							analysis.journey.length > 0 && (
								<JourneyDisplay
									journey={analysis.journey}
									theme={theme}
									showHeader
								/>
							)}
						{show("sound") && analysis.sonic_texture && (
							<BodyCopy text={analysis.sonic_texture} theme={theme} />
						)}
					</div>
				)}
			</div>
		</VariantShell>
	);
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
