import { useMemo, useState } from "react";
import type { AnalysisContent, LikedSong } from "@/features/liked-songs/types";
import { fonts } from "@/lib/theme/fonts";
import { useThemeWithOverride } from "@/lib/theme/ThemeHueProvider";
import type { ThemeConfig } from "@/lib/theme/types";
import { GenreRow, HeadlineToggle } from "./_ProdPrimitives";
import { HeroTitleBlock, VariantShell } from "./_VariantShell";

interface Props {
	song: LikedSong;
	albumArtUrl?: string;
	artistImageUrl?: string;
	isExpanded: boolean;
	onClose: () => void;
}

const MOOD_INTENSITY: { match: RegExp; weight: number }[] = [
	{ match: /(rage|fierce|fury|intens|harsh|aggress)/i, weight: 0.95 },
	{ match: /(yearn|long|ach|crav|burn)/i, weight: 0.8 },
	{ match: /(triumph|elat|euphor|soar)/i, weight: 0.88 },
	{ match: /(tens|brood|simmer)/i, weight: 0.72 },
	{ match: /(steady|resolute|grounded|firm)/i, weight: 0.55 },
	{ match: /(reflect|nostalg|contempl|wist)/i, weight: 0.42 },
	{ match: /(calm|hush|still|tender)/i, weight: 0.28 },
	{ match: /(mourn|grief|sorrow|melanch)/i, weight: 0.38 },
];

function intensityOf(mood: string): number {
	for (const { match, weight } of MOOD_INTENSITY) {
		if (match.test(mood)) return weight;
	}
	return 0.5;
}

export function PanelVariantMoodArc({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis as AnalysisContent | undefined;
	const [pick, setPick] = useState(0);

	const arc = useMemo(() => {
		if (!analysis?.journey?.length) return [];
		const journey = analysis.journey;
		const lines = analysis.key_lines ?? [];
		const themes = analysis.themes ?? [];
		return journey.map((s, i) => {
			const intensity = intensityOf(`${s.mood} ${s.description}`);
			const lineHere =
				lines.length > 0
					? lines[Math.min(Math.floor((i / journey.length) * lines.length), lines.length - 1)]
					: null;
			const text = `${s.mood} ${s.description}`.toLowerCase();
			const themeHere =
				themes.find((t) => {
					for (const w of t.name.split(/\s+/)) {
						if (w.length >= 4 && text.includes(w.toLowerCase())) return true;
					}
					return false;
				}) ?? null;
			return { section: s, intensity, lineHere, themeHere };
		});
	}, [analysis]);

	const safe = arc.length > 0 ? Math.min(pick, arc.length - 1) : 0;
	const current = arc[safe];

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

				{!analysis?.headline ? (
					<EmptyState theme={theme} />
				) : (
					<HeadlineToggle
						headline={analysis.headline}
						interpretation={analysis.interpretation}
						theme={theme}
						size={26}
					/>
				)}

				{arc.length > 0 && analysis?.compound_mood && (
					<p
						style={{
							fontFamily: fonts.body,
							fontWeight: 500,
							fontSize: 11,
							letterSpacing: "0.12em",
							textTransform: "uppercase",
							color: theme.primary,
							margin: 0,
						}}
					>
						overall · {analysis.compound_mood}
					</p>
				)}

				{arc.length > 0 && (
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: 6,
							paddingTop: 4,
						}}
					>
						<span
							style={{
								fontFamily: fonts.body,
								fontSize: 10,
								letterSpacing: "0.1em",
								textTransform: "uppercase",
								color: theme.textMuted,
							}}
						>
							Mood arc · click a moment
						</span>
						<div
							style={{
								display: "flex",
								alignItems: "flex-end",
								gap: 3,
								height: 80,
								paddingTop: 6,
							}}
						>
							{arc.map((m, i) => {
								const active = i === safe;
								return (
									<button
										key={`${m.section.section}-${i}`}
										type="button"
										onClick={() => setPick(i)}
										aria-label={`${m.section.section}: ${m.section.mood}`}
										style={{
											flex: 1,
											height: `${Math.round(m.intensity * 100)}%`,
											minHeight: 8,
											background: active ? theme.primary : theme.border,
											border: "none",
											borderRadius: 2,
											padding: 0,
											cursor: "pointer",
											transition: "background 200ms ease, opacity 200ms ease",
											opacity: active ? 1 : 0.85,
										}}
									/>
								);
							})}
						</div>
						<div
							style={{
								display: "flex",
								gap: 3,
								marginTop: 4,
							}}
						>
							{arc.map((m, i) => (
								<button
									key={`label-${i}`}
									type="button"
									onClick={() => setPick(i)}
									style={{
										flex: 1,
										background: "transparent",
										border: "none",
										padding: 0,
										cursor: "pointer",
										fontFamily: fonts.body,
										fontSize: 9,
										letterSpacing: "0.06em",
										textTransform: "uppercase",
										color: i === safe ? theme.primary : theme.textMuted,
										whiteSpace: "nowrap",
										overflow: "hidden",
										textOverflow: "ellipsis",
										textAlign: "center",
									}}
								>
									{m.section.section}
								</button>
							))}
						</div>
					</div>
				)}

				{current && (
					<div
						key={safe}
						style={{
							animation: "hearted-fade 240ms ease",
							display: "flex",
							flexDirection: "column",
							gap: 14,
							paddingTop: 16,
							borderTop: `1px solid ${theme.border}`,
						}}
					>
						<div
							style={{
								fontFamily: fonts.display,
								fontStyle: "italic",
								fontSize: 24,
								lineHeight: 1.3,
								color: theme.text,
							}}
						>
							{current.section.mood}
						</div>
						<p
							style={{
								fontFamily: fonts.body,
								fontSize: 14,
								lineHeight: 1.7,
								color: theme.textMuted,
								margin: 0,
							}}
						>
							{current.section.description}
						</p>
						{current.lineHere && (
							<blockquote
								style={{
									margin: 0,
									paddingLeft: 12,
									borderLeft: `2px solid ${theme.primary}`,
								}}
							>
								<p
									style={{
										fontFamily: fonts.display,
										fontStyle: "italic",
										fontSize: 15,
										lineHeight: 1.45,
										color: theme.text,
										margin: 0,
									}}
								>
									&ldquo;{current.lineHere.line}&rdquo;
								</p>
								<p
									style={{
										fontFamily: fonts.body,
										fontSize: 11,
										lineHeight: 1.55,
										color: theme.textMuted,
										margin: "6px 0 0",
									}}
								>
									{current.lineHere.insight}
								</p>
							</blockquote>
						)}
						{current.themeHere && (
							<div
								style={{
									display: "flex",
									alignItems: "baseline",
									gap: 10,
								}}
							>
								<span
									style={{
										fontFamily: fonts.body,
										fontSize: 9,
										letterSpacing: "0.12em",
										textTransform: "uppercase",
										color: theme.textMuted,
									}}
								>
									theme here
								</span>
								<span
									style={{
										fontFamily: fonts.display,
										fontStyle: "italic",
										fontSize: 13,
										color: theme.primary,
									}}
								>
									{current.themeHere.name}
								</span>
							</div>
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
