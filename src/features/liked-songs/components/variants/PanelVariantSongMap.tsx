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

interface LineMarker {
	idx: number;
	sectionIdx: number;
	positionInSection: number;
	line: NonNullable<AnalysisContent["key_lines"]>[number];
}

type Selection =
	| { kind: "section"; sectionIdx: number }
	| { kind: "line"; lineIdx: number }
	| null;

export function PanelVariantSongMap({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis as AnalysisContent | undefined;
	const [sel, setSel] = useState<Selection>(null);

	const journey = analysis?.journey ?? [];
	const lines = analysis?.key_lines ?? [];
	const themes = analysis?.themes ?? [];

	const markers = useMemo<LineMarker[]>(() => {
		if (lines.length === 0 || journey.length === 0) return [];
		return lines.map((line, idx) => {
			const slot = (idx + 0.5) / lines.length;
			const sectionIdx = Math.min(
				Math.floor(slot * journey.length),
				journey.length - 1,
			);
			const sectionStart = sectionIdx / journey.length;
			const sectionEnd = (sectionIdx + 1) / journey.length;
			const positionInSection =
				(slot - sectionStart) / (sectionEnd - sectionStart);
			return { idx, sectionIdx, positionInSection, line };
		});
	}, [lines, journey]);

	const themeForSection = (i: number) => {
		if (i < 0 || i >= journey.length) return null;
		const text =
			`${journey[i].section} ${journey[i].mood} ${journey[i].description}`.toLowerCase();
		return (
			themes.find((t) => {
				for (const w of t.name.split(/\s+/)) {
					if (w.length >= 4 && text.includes(w.toLowerCase())) return true;
				}
				return false;
			}) ?? null
		);
	};

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

				{journey.length > 0 && (
					<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
						<span
							style={{
								fontFamily: fonts.body,
								fontSize: 10,
								letterSpacing: "0.1em",
								textTransform: "uppercase",
								color: theme.textMuted,
							}}
						>
							Map · sections, lyrics as marks
						</span>
						<div
							style={{
								display: "flex",
								gap: 4,
								position: "relative",
							}}
						>
							{journey.map((j, i) => {
								const selected =
									sel?.kind === "section" && sel.sectionIdx === i;
								return (
									<button
										key={`${j.section}-${i}`}
										type="button"
										onClick={() =>
											setSel(
												selected ? null : { kind: "section", sectionIdx: i },
											)
										}
										style={{
											flex: 1,
											position: "relative",
											height: 56,
											background: selected ? theme.primary : theme.surface,
											border: `1px solid ${selected ? theme.primary : theme.border}`,
											borderRadius: 4,
											cursor: "pointer",
											padding: "6px 6px 4px",
											display: "flex",
											flexDirection: "column",
											alignItems: "flex-start",
											justifyContent: "flex-start",
											textAlign: "left",
											gap: 2,
											transition: "background 160ms ease, border-color 160ms ease",
										}}
									>
										<span
											style={{
												fontFamily: fonts.body,
												fontSize: 9,
												letterSpacing: "0.08em",
												textTransform: "uppercase",
												color: selected ? theme.textOnPrimary : theme.primary,
												whiteSpace: "nowrap",
												overflow: "hidden",
												textOverflow: "ellipsis",
												maxWidth: "100%",
											}}
										>
											{j.section}
										</span>
										<span
											style={{
												fontFamily: fonts.display,
												fontStyle: "italic",
												fontSize: 10,
												color: selected ? theme.textOnPrimary : theme.textMuted,
												whiteSpace: "nowrap",
												overflow: "hidden",
												textOverflow: "ellipsis",
												maxWidth: "100%",
												opacity: selected ? 0.9 : 1,
											}}
										>
											{j.mood}
										</span>
										{markers
											.filter((m) => m.sectionIdx === i)
											.map((m) => (
												<button
													key={m.idx}
													type="button"
													onClick={(e) => {
														e.stopPropagation();
														setSel(
															sel?.kind === "line" && sel.lineIdx === m.idx
																? null
																: { kind: "line", lineIdx: m.idx },
														);
													}}
													aria-label={`Line ${m.idx + 1}`}
													style={{
														position: "absolute",
														bottom: 4,
														left: `calc(${m.positionInSection * 100}% - 4px)`,
														width: 8,
														height: 8,
														borderRadius: "50%",
														background:
															sel?.kind === "line" && sel.lineIdx === m.idx
																? theme.text
																: selected
																	? theme.textOnPrimary
																	: theme.primary,
														border: "none",
														padding: 0,
														cursor: "pointer",
														transition: "background 160ms ease",
													}}
												/>
											))}
									</button>
								);
							})}
						</div>
					</div>
				)}

				{sel?.kind === "section" && journey[sel.sectionIdx] && (
					<SectionDetail
						section={journey[sel.sectionIdx]}
						relatedTheme={themeForSection(sel.sectionIdx)}
						relatedLines={markers
							.filter((m) => m.sectionIdx === sel.sectionIdx)
							.map((m) => m.line)}
						theme={theme}
					/>
				)}

				{sel?.kind === "line" && markers[sel.lineIdx] && (
					<LineDetail
						marker={markers[sel.lineIdx]}
						section={journey[markers[sel.lineIdx].sectionIdx] ?? null}
						theme={theme}
					/>
				)}

				{!sel && journey.length > 0 && (
					<p
						style={{
							fontFamily: fonts.body,
							fontStyle: "italic",
							fontSize: 12,
							color: theme.textMuted,
							margin: 0,
							textAlign: "center",
						}}
					>
						click a section or a dot
					</p>
				)}
			</div>
		</VariantShell>
	);
}

function SectionDetail({
	section,
	relatedTheme,
	relatedLines,
	theme,
}: {
	section: NonNullable<AnalysisContent["journey"]>[number];
	relatedTheme: NonNullable<AnalysisContent["themes"]>[number] | null;
	relatedLines: NonNullable<AnalysisContent["key_lines"]>;
	theme: ThemeConfig;
}) {
	return (
		<div
			key={section.section}
			style={{
				animation: "hearted-fade 240ms ease",
				display: "flex",
				flexDirection: "column",
				gap: 12,
				paddingTop: 12,
				borderTop: `1px solid ${theme.border}`,
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
				{section.section} · {section.mood}
			</span>
			<p
				style={{
					fontFamily: fonts.body,
					fontSize: 14,
					lineHeight: 1.7,
					color: theme.text,
					margin: 0,
				}}
			>
				{section.description}
			</p>
			{relatedLines.length > 0 && (
				<div>
					<MicroLabel theme={theme}>lines that land here</MicroLabel>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: 8,
							marginTop: 6,
						}}
					>
						{relatedLines.map((l, i) => (
							<p
								key={i}
								style={{
									fontFamily: fonts.display,
									fontStyle: "italic",
									fontSize: 14,
									lineHeight: 1.45,
									color: theme.text,
									margin: 0,
									paddingLeft: 10,
									borderLeft: `2px solid ${theme.primary}`,
								}}
							>
								&ldquo;{l.line}&rdquo;
							</p>
						))}
					</div>
				</div>
			)}
			{relatedTheme && (
				<div
					style={{
						display: "flex",
						alignItems: "baseline",
						gap: 8,
					}}
				>
					<MicroLabel theme={theme}>theme present</MicroLabel>
					<span
						style={{
							fontFamily: fonts.display,
							fontStyle: "italic",
							fontSize: 13,
							color: theme.primary,
						}}
					>
						{relatedTheme.name}
					</span>
				</div>
			)}
		</div>
	);
}

function LineDetail({
	marker,
	section,
	theme,
}: {
	marker: LineMarker;
	section: NonNullable<AnalysisContent["journey"]>[number] | null;
	theme: ThemeConfig;
}) {
	return (
		<div
			key={marker.idx}
			style={{
				animation: "hearted-fade 240ms ease",
				display: "flex",
				flexDirection: "column",
				gap: 10,
				paddingTop: 12,
				borderTop: `1px solid ${theme.border}`,
			}}
		>
			{section && (
				<MicroLabel theme={theme}>
					{section.section} · {section.mood}
				</MicroLabel>
			)}
			<p
				style={{
					fontFamily: fonts.display,
					fontStyle: "italic",
					fontSize: 19,
					lineHeight: 1.4,
					color: theme.text,
					margin: 0,
					paddingLeft: 12,
					borderLeft: `2px solid ${theme.primary}`,
				}}
			>
				&ldquo;{marker.line.line}&rdquo;
			</p>
			<p
				style={{
					fontFamily: fonts.body,
					fontSize: 13,
					lineHeight: 1.65,
					color: theme.textMuted,
					margin: 0,
				}}
			>
				{marker.line.insight}
			</p>
		</div>
	);
}

function MicroLabel({
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
