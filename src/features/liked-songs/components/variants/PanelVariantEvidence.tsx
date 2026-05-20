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

type Lens = "themes" | "lines" | "sections";

function relatedLineForTheme(
	theme: NonNullable<AnalysisContent["themes"]>[number],
	lines: NonNullable<AnalysisContent["key_lines"]>,
) {
	const lc = theme.name.toLowerCase();
	for (const l of lines) {
		if (
			l.line.toLowerCase().includes(lc) ||
			l.insight.toLowerCase().includes(lc)
		) {
			return l;
		}
	}
	return lines[0] ?? null;
}

function relatedSectionForTheme(
	theme: NonNullable<AnalysisContent["themes"]>[number],
	journey: NonNullable<AnalysisContent["journey"]>,
) {
	const lc = theme.name.toLowerCase();
	for (const j of journey) {
		if (
			j.description.toLowerCase().includes(lc) ||
			j.mood.toLowerCase().includes(lc)
		) {
			return j;
		}
	}
	return null;
}

function sectionForLine(
	idx: number,
	totalLines: number,
	journey: NonNullable<AnalysisContent["journey"]>,
) {
	if (journey.length === 0) return null;
	const slot = Math.min(
		Math.floor((idx / Math.max(totalLines, 1)) * journey.length),
		journey.length - 1,
	);
	return journey[slot];
}

function themeForText(
	text: string,
	themes: NonNullable<AnalysisContent["themes"]>,
) {
	const lc = text.toLowerCase();
	for (const t of themes) {
		for (const w of t.name.split(/\s+/)) {
			if (w.length >= 4 && lc.includes(w.toLowerCase())) return t;
		}
	}
	return null;
}

export function PanelVariantEvidence({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis as AnalysisContent | undefined;
	const [lens, setLens] = useState<Lens>("themes");

	const counts = useMemo(
		() => ({
			themes: analysis?.themes?.length ?? 0,
			lines: analysis?.key_lines?.length ?? 0,
			sections: analysis?.journey?.length ?? 0,
		}),
		[analysis],
	);

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
					<>
						<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
							<HeadlineToggle
								headline={analysis.headline}
								interpretation={analysis.interpretation}
								theme={theme}
								size={32}
							/>
							<p
								style={{
									fontFamily: fonts.body,
									fontStyle: "italic",
									fontSize: 12,
									color: theme.textMuted,
									margin: 0,
								}}
							>
								Read the evidence by…
							</p>
							<div
								style={{
									display: "flex",
									gap: 0,
									borderBottom: `1px solid ${theme.border}`,
								}}
							>
								{(
									[
										{ key: "themes" as const, label: "theme", count: counts.themes },
										{ key: "lines" as const, label: "line", count: counts.lines },
										{ key: "sections" as const, label: "section", count: counts.sections },
									] as const
								)
									.filter((l) => l.count > 0)
									.map((l) => {
										const active = lens === l.key;
										return (
											<button
												key={l.key}
												type="button"
												onClick={() => setLens(l.key)}
												style={{
													background: "transparent",
													border: "none",
													padding: "10px 14px 12px",
													cursor: "pointer",
													fontFamily: fonts.body,
													fontSize: 12,
													letterSpacing: "0.04em",
													color: active ? theme.text : theme.textMuted,
													borderBottom: `2px solid ${active ? theme.primary : "transparent"}`,
													marginBottom: -1,
													transition: "color 160ms ease, border-color 160ms ease",
												}}
											>
												by {l.label}{" "}
												<span style={{ opacity: 0.6 }}>· {l.count}</span>
											</button>
										);
									})}
							</div>
						</div>

						<div
							key={lens}
							style={{ animation: "hearted-fade 220ms ease" }}
						>
							{lens === "themes" && analysis.themes && (
								<ThemeEvidence
									themes={analysis.themes}
									lines={analysis.key_lines ?? []}
									journey={analysis.journey ?? []}
									theme={theme}
								/>
							)}
							{lens === "lines" && analysis.key_lines && (
								<LineEvidence
									lines={analysis.key_lines}
									journey={analysis.journey ?? []}
									themes={analysis.themes ?? []}
									theme={theme}
								/>
							)}
							{lens === "sections" && analysis.journey && (
								<SectionEvidence
									journey={analysis.journey}
									lines={analysis.key_lines ?? []}
									themes={analysis.themes ?? []}
									theme={theme}
								/>
							)}
						</div>
					</>
				)}
			</div>
		</VariantShell>
	);
}

function ThemeEvidence({
	themes,
	lines,
	journey,
	theme,
}: {
	themes: NonNullable<AnalysisContent["themes"]>;
	lines: NonNullable<AnalysisContent["key_lines"]>;
	journey: NonNullable<AnalysisContent["journey"]>;
	theme: ThemeConfig;
}) {
	const [open, setOpen] = useState(0);
	const safe = Math.min(open, themes.length - 1);
	const current = themes[safe];
	const relLine = relatedLineForTheme(current, lines);
	const relSection = relatedSectionForTheme(current, journey);

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
			<div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
				{themes.map((t, i) => {
					const active = i === safe;
					return (
						<button
							key={`${t.name}-${i}`}
							type="button"
							onClick={() => setOpen(i)}
							style={{
								background: "transparent",
								border: "none",
								borderTop: i === 0 ? "none" : `1px solid ${theme.border}`,
								padding: "10px 0",
								cursor: "pointer",
								textAlign: "left",
								fontFamily: fonts.display,
								fontSize: 16,
								color: active ? theme.primary : theme.text,
								fontStyle: active ? "italic" : "normal",
								transition: "color 160ms ease",
							}}
						>
							{t.name}
						</button>
					);
				})}
			</div>

			<div
				key={safe}
				style={{
					animation: "hearted-fade 240ms ease",
					display: "flex",
					flexDirection: "column",
					gap: 14,
					padding: "16px",
					background: theme.surface,
					borderRadius: 6,
				}}
			>
				<p
					style={{
						fontFamily: fonts.body,
						fontSize: 14,
						lineHeight: 1.7,
						color: theme.text,
						margin: 0,
					}}
				>
					{current.description}
				</p>
				{relLine && (
					<div>
						<EvidenceLabel theme={theme}>shown in this line</EvidenceLabel>
						<blockquote
							style={{
								margin: "4px 0 0",
								paddingLeft: 12,
								borderLeft: `2px solid ${theme.primary}`,
							}}
						>
							<p
								style={{
									fontFamily: fonts.display,
									fontStyle: "italic",
									fontSize: 14,
									lineHeight: 1.45,
									color: theme.text,
									margin: 0,
								}}
							>
								&ldquo;{relLine.line}&rdquo;
							</p>
						</blockquote>
					</div>
				)}
				{relSection && (
					<div>
						<EvidenceLabel theme={theme}>surfaces in</EvidenceLabel>
						<div
							style={{
								fontFamily: fonts.display,
								fontStyle: "italic",
								fontSize: 13,
								color: theme.text,
								marginTop: 2,
							}}
						>
							{relSection.section} · {relSection.mood}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function LineEvidence({
	lines,
	journey,
	themes,
	theme,
}: {
	lines: NonNullable<AnalysisContent["key_lines"]>;
	journey: NonNullable<AnalysisContent["journey"]>;
	themes: NonNullable<AnalysisContent["themes"]>;
	theme: ThemeConfig;
}) {
	const [idx, setIdx] = useState(0);
	const safe = Math.min(idx, lines.length - 1);
	const line = lines[safe];
	const section = sectionForLine(safe, lines.length, journey);
	const t = themeForText(`${line.line} ${line.insight}`, themes);

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
			<blockquote
				key={safe}
				style={{
					margin: 0,
					paddingLeft: 14,
					borderLeft: `2px solid ${theme.primary}`,
				}}
			>
				<p
					style={{
						fontFamily: fonts.display,
						fontStyle: "italic",
						fontSize: 22,
						lineHeight: 1.35,
						color: theme.text,
						margin: 0,
					}}
				>
					&ldquo;{line.line}&rdquo;
				</p>
				<p
					style={{
						fontFamily: fonts.body,
						fontSize: 13,
						lineHeight: 1.65,
						color: theme.textMuted,
						margin: "10px 0 0",
					}}
				>
					{line.insight}
				</p>
			</blockquote>
			<div
				style={{
					display: "flex",
					gap: 18,
					flexWrap: "wrap",
					paddingTop: 8,
					borderTop: `1px dashed ${theme.border}`,
				}}
			>
				{section && (
					<div>
						<EvidenceLabel theme={theme}>lands in</EvidenceLabel>
						<div
							style={{
								fontFamily: fonts.display,
								fontStyle: "italic",
								fontSize: 13,
								color: theme.text,
								marginTop: 2,
							}}
						>
							{section.section} · {section.mood}
						</div>
					</div>
				)}
				{t && (
					<div>
						<EvidenceLabel theme={theme}>theme</EvidenceLabel>
						<div
							style={{
								fontFamily: fonts.display,
								fontStyle: "italic",
								fontSize: 13,
								color: theme.primary,
								marginTop: 2,
							}}
						>
							{t.name}
						</div>
					</div>
				)}
			</div>
			{lines.length > 1 && (
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
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
						line {safe + 1} of {lines.length}
					</span>
					<div style={{ display: "flex", gap: 16 }}>
						<button
							type="button"
							onClick={() => setIdx(Math.max(0, safe - 1))}
							disabled={safe === 0}
							style={textBtn(theme, safe === 0)}
						>
							← prev
						</button>
						<button
							type="button"
							onClick={() => setIdx(Math.min(lines.length - 1, safe + 1))}
							disabled={safe === lines.length - 1}
							style={textBtn(theme, safe === lines.length - 1)}
						>
							next →
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

function SectionEvidence({
	journey,
	lines,
	themes,
	theme,
}: {
	journey: NonNullable<AnalysisContent["journey"]>;
	lines: NonNullable<AnalysisContent["key_lines"]>;
	themes: NonNullable<AnalysisContent["themes"]>;
	theme: ThemeConfig;
}) {
	const [idx, setIdx] = useState(0);
	const safe = Math.min(idx, journey.length - 1);
	const section = journey[safe];
	const lineHere =
		lines.length > 0
			? lines[Math.min(Math.floor((safe / journey.length) * lines.length), lines.length - 1)]
			: null;
	const t = themeForText(
		`${section.section} ${section.mood} ${section.description}`,
		themes,
	);

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
			<div
				style={{
					display: "flex",
					alignItems: "flex-end",
					gap: 6,
				}}
			>
				{journey.map((j, i) => {
					const active = i === safe;
					return (
						<button
							key={`${j.section}-${i}`}
							type="button"
							onClick={() => setIdx(i)}
							aria-label={j.section}
							style={{
								flex: 1,
								height: active ? 28 : 14,
								background: active ? theme.primary : theme.border,
								border: "none",
								borderRadius: 2,
								cursor: "pointer",
								padding: 0,
								transition: "height 220ms ease, background 200ms ease",
								fontFamily: fonts.body,
								fontSize: 9,
								letterSpacing: "0.06em",
								color: active ? theme.textOnPrimary : "transparent",
								whiteSpace: "nowrap",
								overflow: "hidden",
							}}
						>
							{j.section.slice(0, 6)}
						</button>
					);
				})}
			</div>

			<div
				key={safe}
				style={{
					animation: "hearted-fade 240ms ease",
					display: "flex",
					flexDirection: "column",
					gap: 12,
				}}
			>
				<span
					style={{
						fontFamily: fonts.body,
						fontSize: 10,
						letterSpacing: "0.12em",
						textTransform: "uppercase",
						color: theme.primary,
					}}
				>
					{section.section}
				</span>
				<div
					style={{
						fontFamily: fonts.display,
						fontStyle: "italic",
						fontSize: 22,
						color: theme.text,
					}}
				>
					{section.mood}
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
					{section.description}
				</p>
				{lineHere && (
					<div style={{ marginTop: 4 }}>
						<EvidenceLabel theme={theme}>a line lands here</EvidenceLabel>
						<blockquote
							style={{
								margin: "4px 0 0",
								paddingLeft: 12,
								borderLeft: `2px solid ${theme.primary}`,
							}}
						>
							<p
								style={{
									fontFamily: fonts.display,
									fontStyle: "italic",
									fontSize: 15,
									color: theme.text,
									margin: 0,
								}}
							>
								&ldquo;{lineHere.line}&rdquo;
							</p>
						</blockquote>
					</div>
				)}
				{t && (
					<div>
						<EvidenceLabel theme={theme}>theme present</EvidenceLabel>
						<div
							style={{
								fontFamily: fonts.display,
								fontStyle: "italic",
								fontSize: 13,
								color: theme.primary,
								marginTop: 2,
							}}
						>
							{t.name}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function EvidenceLabel({
	theme,
	children,
}: {
	theme: ThemeConfig;
	children: React.ReactNode;
}) {
	return (
		<span
			style={{
				fontFamily: fonts.body,
				fontSize: 9,
				letterSpacing: "0.12em",
				textTransform: "uppercase",
				color: theme.textMuted,
			}}
		>
			{children}
		</span>
	);
}

function textBtn(theme: ThemeConfig, disabled: boolean): React.CSSProperties {
	return {
		background: "transparent",
		border: "none",
		padding: 0,
		cursor: disabled ? "default" : "pointer",
		fontFamily: fonts.body,
		fontSize: 11,
		letterSpacing: "0.04em",
		color: disabled ? theme.border : theme.primary,
	};
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
