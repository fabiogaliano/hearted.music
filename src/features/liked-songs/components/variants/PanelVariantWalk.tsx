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

interface Moment {
	section: NonNullable<AnalysisContent["journey"]>[number];
	line: NonNullable<AnalysisContent["key_lines"]>[number] | null;
	theme: NonNullable<AnalysisContent["themes"]>[number] | null;
}

export function PanelVariantWalk({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis as AnalysisContent | undefined;
	const [idx, setIdx] = useState(0);

	const moments = useMemo<Moment[]>(() => {
		if (!analysis?.journey?.length) return [];
		const journey = analysis.journey;
		const lines = analysis.key_lines ?? [];
		const themes = analysis.themes ?? [];
		return journey.map((section, i) => {
			const lineForSection =
				lines.length > 0
					? lines[Math.min(Math.floor((i / journey.length) * lines.length), lines.length - 1)]
					: null;
			const sectionText =
				`${section.section} ${section.mood} ${section.description}`.toLowerCase();
			const dominantTheme =
				themes.find((t) => {
					for (const w of t.name.split(/\s+/)) {
						if (w.length >= 4 && sectionText.includes(w.toLowerCase()))
							return true;
					}
					return false;
				}) ??
				themes[Math.min(i, themes.length - 1)] ??
				null;
			return { section, line: lineForSection, theme: dominantTheme };
		});
	}, [analysis]);

	const safe = moments.length > 0 ? Math.min(idx, moments.length - 1) : 0;
	const m = moments[safe];

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
					<HeadlineToggle
						headline={analysis.headline}
						interpretation={analysis.interpretation}
						theme={theme}
						size={24}
					/>
				)}

				{m && (
					<div
						key={safe}
						style={{
							animation: "hearted-fade 260ms ease",
							display: "flex",
							flexDirection: "column",
							gap: 18,
							paddingTop: 8,
							borderTop: `1px solid ${theme.border}`,
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
									color: theme.primary,
								}}
							>
								Moment · {m.section.section}
							</span>
							<span
								style={{
									fontFamily: fonts.body,
									fontSize: 11,
									color: theme.textMuted,
								}}
							>
								{safe + 1} of {moments.length}
							</span>
						</div>

						<div
							style={{
								fontFamily: fonts.display,
								fontStyle: "italic",
								fontSize: 26,
								lineHeight: 1.3,
								color: theme.text,
							}}
						>
							{m.section.mood}
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
							{m.section.description}
						</p>

						{m.line && (
							<blockquote
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
										fontSize: 17,
										lineHeight: 1.45,
										color: theme.text,
										margin: 0,
									}}
								>
									&ldquo;{m.line.line}&rdquo;
								</p>
								<p
									style={{
										fontFamily: fonts.body,
										fontSize: 12,
										lineHeight: 1.6,
										color: theme.textMuted,
										margin: "8px 0 0",
									}}
								>
									{m.line.insight}
								</p>
							</blockquote>
						)}

						{m.theme && (
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: 4,
									paddingTop: 12,
									borderTop: `1px dashed ${theme.border}`,
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
									theme surfacing here
								</span>
								<span
									style={{
										fontFamily: fonts.display,
										fontStyle: "italic",
										fontSize: 14,
										color: theme.primary,
									}}
								>
									{m.theme.name}
								</span>
								<p
									style={{
										fontFamily: fonts.body,
										fontSize: 12,
										lineHeight: 1.5,
										color: theme.textMuted,
										margin: 0,
									}}
								>
									{m.theme.description}
								</p>
							</div>
						)}
					</div>
				)}
			</div>

			{moments.length > 1 && (
				<div
					style={{
						position: "sticky",
						bottom: 0,
						background: theme.bg,
						borderTop: `1px solid ${theme.border}`,
						padding: "12px 24px",
						display: "flex",
						alignItems: "center",
						gap: 12,
					}}
				>
					<button
						type="button"
						onClick={() => setIdx((i) => Math.max(0, i - 1))}
						disabled={safe === 0}
						aria-label="Previous moment"
						style={iconBtn(theme, safe === 0)}
					>
						<ArrowLeftIcon size={13} />
					</button>
					<div
						style={{
							flex: 1,
							display: "grid",
							gridTemplateColumns: `repeat(${moments.length}, 1fr)`,
							gap: 2,
						}}
					>
						{moments.map((_, i) => (
							<button
								key={i}
								type="button"
								onClick={() => setIdx(i)}
								aria-label={`Moment ${i + 1}`}
								style={{
									height: 4,
									borderRadius: 999,
									background: i === safe ? theme.primary : theme.border,
									border: "none",
									padding: 0,
									cursor: "pointer",
									transition: "background 200ms ease",
								}}
							/>
						))}
					</div>
					<button
						type="button"
						onClick={() => setIdx((i) => Math.min(moments.length - 1, i + 1))}
						disabled={safe === moments.length - 1}
						aria-label="Next moment"
						style={iconBtn(theme, safe === moments.length - 1)}
					>
						<ArrowRightIcon size={13} />
					</button>
				</div>
			)}
		</VariantShell>
	);
}

function iconBtn(theme: ThemeConfig, disabled: boolean): React.CSSProperties {
	return {
		width: 32,
		height: 32,
		borderRadius: 4,
		border: `1px solid ${theme.border}`,
		background: "transparent",
		color: disabled ? theme.border : theme.text,
		cursor: disabled ? "default" : "pointer",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		flexShrink: 0,
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
