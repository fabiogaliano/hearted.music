import { ArrowLeftIcon, ArrowRightIcon } from "@phosphor-icons/react";
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

export function PanelVariantQuoteReader({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis as AnalysisContent | undefined;
	const [idx, setIdx] = useState(0);

	const lines = analysis?.key_lines ?? [];
	const safeIdx = Math.min(idx, Math.max(lines.length - 1, 0));
	const line = lines[safeIdx];

	const context = useMemo(() => {
		if (!analysis || !line) return null;
		const journey = analysis.journey ?? [];
		const themes = analysis.themes ?? [];
		const sectionIdx =
			journey.length > 0
				? Math.min(
						Math.floor((safeIdx / Math.max(lines.length, 1)) * journey.length),
						journey.length - 1,
					)
				: -1;
		const section = sectionIdx >= 0 ? journey[sectionIdx] : null;
		const lower = `${line.line} ${line.insight}`.toLowerCase();
		const relatedTheme =
			themes.find((t) => {
				for (const w of t.name.split(/\s+/)) {
					if (w.length >= 4 && lower.includes(w.toLowerCase())) return true;
				}
				return false;
			}) ?? null;
		return { section, theme: relatedTheme };
	}, [analysis, line, safeIdx, lines.length]);

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
					padding: "56px 24px 24px",
					display: "flex",
					flexDirection: "column",
					gap: 26,
				}}
			>
				<GenreRow genres={song.track.genres} theme={theme} />

				{!analysis?.headline ? (
					<EmptyState theme={theme} />
				) : (
					<>
						<HeadlineToggle
							headline={analysis.headline}
							interpretation={analysis.interpretation}
							theme={theme}
							size={22}
						/>

						{lines.length === 0 ? (
							<p
								style={{
									fontFamily: fonts.body,
									fontStyle: "italic",
									fontSize: 14,
									color: theme.textMuted,
									margin: 0,
								}}
							>
								No key lines yet.
							</p>
						) : (
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: 20,
									paddingTop: 12,
								}}
							>
								<div
									style={{
										display: "flex",
										alignItems: "baseline",
										justifyContent: "space-between",
									}}
								>
									<span
										style={{
											fontFamily: fonts.body,
											fontSize: 10,
											letterSpacing: "0.12em",
											textTransform: "uppercase",
											color: theme.textMuted,
										}}
									>
										A line from the song
									</span>
									<span
										style={{
											fontFamily: fonts.body,
											fontSize: 11,
											color: theme.primary,
										}}
									>
										{safeIdx + 1} of {lines.length}
									</span>
								</div>

								<div
									key={safeIdx}
									style={{
										animation: "hearted-fade 240ms ease",
										display: "flex",
										flexDirection: "column",
										gap: 18,
									}}
								>
									<p
										style={{
											fontFamily: fonts.display,
											fontStyle: "italic",
											fontSize: 30,
											lineHeight: 1.3,
											color: theme.text,
											margin: 0,
										}}
									>
										&ldquo;{line.line}&rdquo;
									</p>
									<p
										style={{
											fontFamily: fonts.body,
											fontSize: 14,
											lineHeight: 1.7,
											color: theme.textMuted,
											margin: 0,
										}}
									>
										{line.insight}
									</p>
									{(context?.section || context?.theme) && (
										<div
											style={{
												display: "flex",
												flexWrap: "wrap",
												gap: 14,
												alignItems: "baseline",
												paddingTop: 6,
												borderTop: `1px solid ${theme.border}`,
											}}
										>
											{context.section && (
												<div>
													<span
														style={{
															fontFamily: fonts.body,
															fontSize: 9,
															letterSpacing: "0.1em",
															textTransform: "uppercase",
															color: theme.textMuted,
														}}
													>
														where in the song
													</span>
													<div
														style={{
															fontFamily: fonts.display,
															fontStyle: "italic",
															fontSize: 13,
															color: theme.text,
															marginTop: 2,
														}}
													>
														{context.section.section} · {context.section.mood}
													</div>
												</div>
											)}
											{context.theme && (
												<div>
													<span
														style={{
															fontFamily: fonts.body,
															fontSize: 9,
															letterSpacing: "0.1em",
															textTransform: "uppercase",
															color: theme.textMuted,
														}}
													>
														speaks to
													</span>
													<div
														style={{
															fontFamily: fonts.display,
															fontStyle: "italic",
															fontSize: 13,
															color: theme.text,
															marginTop: 2,
														}}
													>
														{context.theme.name}
													</div>
												</div>
											)}
										</div>
									)}
								</div>
							</div>
						)}
					</>
				)}
			</div>

			{lines.length > 1 && (
				<div
					style={{
						position: "sticky",
						bottom: 0,
						background: theme.bg,
						borderTop: `1px solid ${theme.border}`,
						padding: "14px 24px",
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
					}}
				>
					<button
						type="button"
						onClick={() => setIdx((i) => Math.max(0, i - 1))}
						disabled={safeIdx === 0}
						style={navBtn(theme, safeIdx === 0)}
						aria-label="Previous line"
					>
						<ArrowLeftIcon size={13} /> prev
					</button>
					<div style={{ display: "flex", gap: 5 }}>
						{lines.map((_, i) => (
							<button
								key={i}
								type="button"
								onClick={() => setIdx(i)}
								aria-label={`Line ${i + 1}`}
								style={{
									width: i === safeIdx ? 18 : 6,
									height: 4,
									borderRadius: 999,
									background: i === safeIdx ? theme.primary : theme.border,
									border: "none",
									padding: 0,
									cursor: "pointer",
									transition: "width 200ms ease, background 200ms ease",
								}}
							/>
						))}
					</div>
					<button
						type="button"
						onClick={() => setIdx((i) => Math.min(lines.length - 1, i + 1))}
						disabled={safeIdx === lines.length - 1}
						style={navBtn(theme, safeIdx === lines.length - 1)}
						aria-label="Next line"
					>
						next <ArrowRightIcon size={13} />
					</button>
				</div>
			)}
		</VariantShell>
	);
}

function navBtn(theme: ThemeConfig, disabled: boolean): React.CSSProperties {
	return {
		display: "inline-flex",
		alignItems: "center",
		gap: 6,
		background: "transparent",
		border: "none",
		padding: 0,
		fontFamily: fonts.body,
		fontSize: 12,
		letterSpacing: "0.04em",
		color: disabled ? theme.border : theme.primary,
		cursor: disabled ? "default" : "pointer",
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
