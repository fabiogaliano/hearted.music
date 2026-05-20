import { useMemo, useState } from "react";
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

interface Mark {
	kind: "theme" | "line" | "section";
	keyword: string;
	label: string;
	body: string;
}

function buildMarks(analysis: AnalysisContent): Mark[] {
	const marks: Mark[] = [];
	for (const t of analysis.themes ?? []) {
		for (const word of t.name.split(/\s+/)) {
			if (word.length >= 4) {
				marks.push({
					kind: "theme",
					keyword: word.toLowerCase(),
					label: t.name,
					body: t.description,
				});
			}
		}
	}
	for (const j of analysis.journey ?? []) {
		for (const word of j.mood.split(/\s+/)) {
			if (word.length >= 4) {
				marks.push({
					kind: "section",
					keyword: word.toLowerCase(),
					label: `${j.section} · ${j.mood}`,
					body: j.description,
				});
			}
		}
	}
	for (const l of analysis.key_lines ?? []) {
		for (const word of l.line.split(/\s+/)) {
			const clean = word.replace(/[^\p{L}\p{N}]/gu, "");
			if (clean.length >= 5) {
				marks.push({
					kind: "line",
					keyword: clean.toLowerCase(),
					label: `"${l.line}"`,
					body: l.insight,
				});
			}
		}
	}
	return marks;
}

export function PanelVariantMarginalia({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis as AnalysisContent | undefined;
	const [active, setActive] = useState<Mark | null>(null);

	const marks = useMemo(
		() => (analysis ? buildMarks(analysis) : []),
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
						<p
							style={{
								fontFamily: fonts.display,
								fontWeight: 400,
								fontSize: 30,
								lineHeight: 1.22,
								color: theme.text,
								margin: 0,
							}}
						>
							{analysis.headline}
						</p>

						{analysis.compound_mood && (
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
								{analysis.compound_mood}
							</p>
						)}

						{analysis.interpretation ? (
							<div
								style={{
									fontFamily: fonts.body,
									fontSize: 15,
									lineHeight: 1.8,
									color: theme.text,
								}}
							>
								<AnnotatedProse
									text={analysis.interpretation}
									marks={marks}
									onPick={setActive}
									activeKeyword={active?.keyword ?? null}
									theme={theme}
								/>
							</div>
						) : (
							<p
								style={{
									fontFamily: fonts.body,
									fontStyle: "italic",
									fontSize: 14,
									color: theme.textMuted,
									margin: 0,
								}}
							>
								No interpretation yet.
							</p>
						)}

						{active && (
							<div
								key={active.keyword}
								style={{
									animation: "hearted-push-up 280ms ease both",
									padding: "16px",
									background: theme.surface,
									borderLeft: `3px solid ${theme.primary}`,
									borderRadius: 4,
									display: "flex",
									flexDirection: "column",
									gap: 8,
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
											fontSize: 9,
											letterSpacing: "0.12em",
											textTransform: "uppercase",
											color: theme.textMuted,
										}}
									>
										{active.kind === "theme" && "Theme"}
										{active.kind === "line" && "From a key line"}
										{active.kind === "section" && "From a section"}
									</span>
									<button
										type="button"
										onClick={() => setActive(null)}
										style={{
											background: "transparent",
											border: "none",
											padding: 0,
											cursor: "pointer",
											fontFamily: fonts.body,
											fontSize: 10,
											letterSpacing: "0.04em",
											color: theme.textMuted,
										}}
									>
										dismiss
									</button>
								</div>
								<div
									style={{
										fontFamily: fonts.display,
										fontStyle: "italic",
										fontSize: 16,
										color: theme.text,
									}}
								>
									{active.label}
								</div>
								<p
									style={{
										fontFamily: fonts.body,
										fontSize: 13,
										lineHeight: 1.6,
										color: theme.textMuted,
										margin: 0,
									}}
								>
									{active.body}
								</p>
							</div>
						)}

						{!active && marks.length > 0 && (
							<p
								style={{
									fontFamily: fonts.body,
									fontStyle: "italic",
									fontSize: 11,
									color: theme.textMuted,
									margin: 0,
									textAlign: "right",
								}}
							>
								click an underlined word to see what it points to
							</p>
						)}
					</>
				)}
			</div>
		</VariantShell>
	);
}

function AnnotatedProse({
	text,
	marks,
	onPick,
	activeKeyword,
	theme,
}: {
	text: string;
	marks: Mark[];
	onPick: (m: Mark) => void;
	activeKeyword: string | null;
	theme: ThemeConfig;
}) {
	const tokens = text.split(/(\s+|[,.;:!?—–"'()])/);
	return (
		<>
			{tokens.map((tok, i) => {
				const clean = tok.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
				if (!clean) return <span key={i}>{tok}</span>;
				const match = marks.find((m) => m.keyword === clean);
				if (!match) return <span key={i}>{tok}</span>;
				const isActive = activeKeyword === clean;
				return (
					<button
						key={i}
						type="button"
						onClick={() => onPick(match)}
						style={{
							background: isActive ? `${theme.primary}1a` : "transparent",
							border: "none",
							padding: 0,
							cursor: "pointer",
							font: "inherit",
							color: isActive ? theme.primary : "inherit",
							borderBottom: `1px solid ${isActive ? theme.primary : theme.textMuted}66`,
							transition: "background 160ms ease, color 160ms ease",
						}}
					>
						{tok}
					</button>
				);
			})}
		</>
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
