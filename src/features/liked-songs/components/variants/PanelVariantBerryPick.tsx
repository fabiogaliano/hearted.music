import { ArrowUUpLeftIcon } from "@phosphor-icons/react";
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

interface FocusedView {
	term: string;
	context: string;
	related: { label: string; term: string; body: string }[];
}

export function PanelVariantBerryPick({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis as AnalysisContent | undefined;
	const [focus, setFocus] = useState<string | null>(null);

	const focused = useMemo<FocusedView | null>(() => {
		if (!analysis || !focus) return null;
		const lc = focus.toLowerCase();
		const matchTheme = analysis.themes?.find(
			(t) => t.name.toLowerCase() === lc,
		);
		const matchLine = analysis.key_lines?.find((l) =>
			l.line.toLowerCase().includes(lc),
		);
		const matchSection = analysis.journey?.find(
			(j) => j.section.toLowerCase() === lc || j.mood.toLowerCase() === lc,
		);
		const related: FocusedView["related"] = [];
		for (const t of analysis.themes ?? []) {
			if (t.name.toLowerCase() === lc) continue;
			if (
				t.description.toLowerCase().includes(lc) ||
				(matchTheme && t.description.toLowerCase().includes(matchTheme.name.toLowerCase()))
			) {
				related.push({ label: "Theme", term: t.name, body: t.description });
			}
		}
		for (const l of analysis.key_lines ?? []) {
			if (l.line.toLowerCase().includes(lc) && l !== matchLine) {
				related.push({ label: "Line", term: `"${l.line}"`, body: l.insight });
			}
		}
		for (const j of analysis.journey ?? []) {
			if (
				j.description.toLowerCase().includes(lc) ||
				j.mood.toLowerCase().includes(lc)
			) {
				if (j !== matchSection) {
					related.push({
						label: "Section",
						term: j.section,
						body: `${j.mood} — ${j.description}`,
					});
				}
			}
		}
		const primary = matchTheme
			? matchTheme.description
			: matchLine
				? matchLine.insight
				: matchSection
					? matchSection.description
					: "Mentioned across the analysis.";
		return { term: focus, context: primary, related };
	}, [analysis, focus]);

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

				{focus && (
					<button
						type="button"
						onClick={() => setFocus(null)}
						style={{
							display: "inline-flex",
							alignItems: "center",
							alignSelf: "flex-start",
							gap: 6,
							background: "transparent",
							border: "none",
							padding: 0,
							cursor: "pointer",
							fontFamily: fonts.body,
							fontSize: 11,
							letterSpacing: "0.06em",
							color: theme.primary,
						}}
					>
						<ArrowUUpLeftIcon size={11} /> back to all
					</button>
				)}

				{!analysis ? (
					<EmptyState theme={theme} />
				) : focused ? (
					<FocusedBody focused={focused} theme={theme} onPick={setFocus} />
				) : (
					<OverviewBody
						analysis={analysis}
						theme={theme}
						onPick={setFocus}
					/>
				)}
			</div>
		</VariantShell>
	);
}

function OverviewBody({
	analysis,
	theme,
	onPick,
}: {
	analysis: AnalysisContent;
	theme: ThemeConfig;
	onPick: (term: string) => void;
}) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
			<p
				style={{
					fontFamily: fonts.body,
					fontSize: 11,
					letterSpacing: "0.08em",
					textTransform: "uppercase",
					color: theme.textMuted,
					margin: 0,
				}}
			>
				Pick a term to follow it
			</p>

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

			{analysis.themes && analysis.themes.length > 0 && (
				<Cluster
					label="Themes"
					theme={theme}
					items={analysis.themes.map((t) => ({ term: t.name, body: t.description }))}
					onPick={onPick}
				/>
			)}

			{analysis.journey && analysis.journey.length > 0 && (
				<Cluster
					label="Sections"
					theme={theme}
					items={analysis.journey.map((j) => ({
						term: j.section,
						body: j.mood,
					}))}
					onPick={onPick}
				/>
			)}

			{analysis.key_lines && analysis.key_lines.length > 0 && (
				<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
					<Label theme={theme}>Key lines</Label>
					{analysis.key_lines.map((l, i) => (
						<p
							key={i}
							style={{
								fontFamily: fonts.display,
								fontStyle: "italic",
								fontSize: 15,
								lineHeight: 1.5,
								color: theme.textMuted,
								margin: 0,
							}}
						>
							&ldquo;
							{l.line.split(/(\s+)/).map((tok, k) => {
								const word = tok.trim();
								if (!word || word.length < 4)
									return <span key={k}>{tok}</span>;
								return (
									<Link
										key={k}
										theme={theme}
										onClick={() => onPick(word.replace(/[^\w-]/g, ""))}
									>
										{tok}
									</Link>
								);
							})}
							&rdquo;
						</p>
					))}
				</div>
			)}
		</div>
	);
}

function FocusedBody({
	focused,
	theme,
	onPick,
}: {
	focused: FocusedView;
	theme: ThemeConfig;
	onPick: (term: string) => void;
}) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
			<div>
				<span
					style={{
						fontFamily: fonts.body,
						fontSize: 10,
						letterSpacing: "0.1em",
						textTransform: "uppercase",
						color: theme.textMuted,
					}}
				>
					Focused on
				</span>
				<h2
					style={{
						fontFamily: fonts.display,
						fontStyle: "italic",
						fontSize: 28,
						lineHeight: 1.2,
						color: theme.primary,
						margin: "4px 0 0",
					}}
				>
					{focused.term}
				</h2>
			</div>
			<p
				style={{
					fontFamily: fonts.body,
					fontSize: 14,
					lineHeight: 1.65,
					color: theme.text,
					margin: 0,
				}}
			>
				{focused.context}
			</p>
			{focused.related.length > 0 && (
				<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
					<Label theme={theme}>Related</Label>
					{focused.related.map((r, i) => (
						<button
							key={`${r.term}-${i}`}
							type="button"
							onClick={() => onPick(r.term.replace(/^"|"$/g, ""))}
							style={{
								textAlign: "left",
								background: "transparent",
								border: `1px solid ${theme.border}`,
								borderRadius: 6,
								padding: "10px 12px",
								cursor: "pointer",
								display: "flex",
								flexDirection: "column",
								gap: 4,
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
								{r.label}
							</span>
							<span
								style={{
									fontFamily: fonts.display,
									fontSize: 14,
									color: theme.text,
								}}
							>
								{r.term}
							</span>
							<span
								style={{
									fontFamily: fonts.body,
									fontSize: 12,
									color: theme.textMuted,
								}}
							>
								{r.body}
							</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function Cluster({
	label,
	items,
	theme,
	onPick,
}: {
	label: string;
	items: { term: string; body: string }[];
	theme: ThemeConfig;
	onPick: (term: string) => void;
}) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
			<Label theme={theme}>{label}</Label>
			<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
				{items.map((it, i) => (
					<button
						key={`${it.term}-${i}`}
						type="button"
						onClick={() => onPick(it.term)}
						style={{
							fontFamily: fonts.body,
							fontSize: 12,
							letterSpacing: "0.04em",
							padding: "5px 10px",
							borderRadius: 999,
							border: `1px solid ${theme.border}`,
							background: "transparent",
							color: theme.text,
							cursor: "pointer",
						}}
					>
						{it.term}
					</button>
				))}
			</div>
		</div>
	);
}

function Link({
	theme,
	onClick,
	children,
}: {
	theme: ThemeConfig;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			style={{
				background: "transparent",
				border: "none",
				padding: 0,
				cursor: "pointer",
				font: "inherit",
				color: "inherit",
				borderBottom: `1px dotted ${theme.primary}`,
			}}
		>
			{children}
		</button>
	);
}

function Label({
	theme,
	children,
}: {
	theme: ThemeConfig;
	children: React.ReactNode;
}) {
	return (
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
			{children}
		</h3>
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
