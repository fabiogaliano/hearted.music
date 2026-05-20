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

type Node =
	| "mood-via-theme"
	| "theme-via-line"
	| "line-via-section"
	| "section-via-line";

interface NodeDef {
	id: Node;
	label: string;
	subtitle: string;
	available: (a: AnalysisContent) => boolean;
}

const NODES: NodeDef[] = [
	{
		id: "mood-via-theme",
		label: "Mood",
		subtitle: "through its themes",
		available: (a) =>
			Boolean(
				(a.compound_mood || a.mood_description) && (a.themes?.length ?? 0) > 0,
			),
	},
	{
		id: "theme-via-line",
		label: "Themes",
		subtitle: "each shown in a line",
		available: (a) =>
			(a.themes?.length ?? 0) > 0 && (a.key_lines?.length ?? 0) > 0,
	},
	{
		id: "line-via-section",
		label: "Lyrics",
		subtitle: "anchored to song sections",
		available: (a) =>
			(a.key_lines?.length ?? 0) > 0 && (a.journey?.length ?? 0) > 0,
	},
	{
		id: "section-via-line",
		label: "Arc",
		subtitle: "narrated by its lines",
		available: (a) =>
			(a.journey?.length ?? 0) > 0 && (a.key_lines?.length ?? 0) > 0,
	},
];

export function PanelVariantHub({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis as AnalysisContent | undefined;
	const [node, setNode] = useState<Node | null>(null);

	const available = useMemo(
		() => (analysis ? NODES.filter((n) => n.available(analysis)) : []),
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
						size={30}
					/>
				)}

				{node === null && available.length > 0 && (
					<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
						<span
							style={{
								fontFamily: fonts.body,
								fontSize: 10,
								letterSpacing: "0.1em",
								textTransform: "uppercase",
								color: theme.textMuted,
							}}
						>
							Pick how to read the song
						</span>
						<div
							style={{
								display: "grid",
								gridTemplateColumns: "1fr 1fr",
								gap: 10,
							}}
						>
							{available.map((n) => (
								<button
									key={n.id}
									type="button"
									onClick={() => setNode(n.id)}
									style={{
										display: "flex",
										flexDirection: "column",
										alignItems: "flex-start",
										gap: 4,
										padding: "16px",
										background: "transparent",
										border: `1px solid ${theme.border}`,
										borderRadius: 6,
										cursor: "pointer",
										textAlign: "left",
										transition: "border-color 160ms ease, background 160ms ease",
									}}
								>
									<span
										style={{
											fontFamily: fonts.display,
											fontSize: 18,
											color: theme.text,
										}}
									>
										{n.label}
									</span>
									<span
										style={{
											fontFamily: fonts.body,
											fontStyle: "italic",
											fontSize: 12,
											color: theme.textMuted,
										}}
									>
										{n.subtitle}
									</span>
								</button>
							))}
						</div>
					</div>
				)}

				{node && analysis && (
					<div
						key={node}
						style={{
							animation: "hearted-fade 240ms ease",
							display: "flex",
							flexDirection: "column",
							gap: 16,
						}}
					>
						<button
							type="button"
							onClick={() => setNode(null)}
							style={{
								alignSelf: "flex-start",
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
							← back to all
						</button>
						{node === "mood-via-theme" && (
							<MoodViaTheme analysis={analysis} theme={theme} />
						)}
						{node === "theme-via-line" && (
							<ThemeViaLine analysis={analysis} theme={theme} />
						)}
						{node === "line-via-section" && (
							<LineViaSection analysis={analysis} theme={theme} />
						)}
						{node === "section-via-line" && (
							<SectionViaLine analysis={analysis} theme={theme} />
						)}
					</div>
				)}
			</div>
		</VariantShell>
	);
}

function MoodViaTheme({
	analysis,
	theme,
}: {
	analysis: AnalysisContent;
	theme: ThemeConfig;
}) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
			{analysis.compound_mood && (
				<div
					style={{
						fontFamily: fonts.display,
						fontStyle: "italic",
						fontSize: 26,
						color: theme.text,
					}}
				>
					{analysis.compound_mood}
				</div>
			)}
			{analysis.mood_description && (
				<p
					style={{
						fontFamily: fonts.body,
						fontSize: 14,
						lineHeight: 1.7,
						color: theme.textMuted,
						margin: 0,
					}}
				>
					{analysis.mood_description}
				</p>
			)}
			<div
				style={{
					paddingTop: 12,
					borderTop: `1px dashed ${theme.border}`,
					display: "flex",
					flexDirection: "column",
					gap: 10,
				}}
			>
				<Label theme={theme}>built from these threads</Label>
				{(analysis.themes ?? []).map((t, i) => (
					<div
						key={`${t.name}-${i}`}
						style={{
							display: "grid",
							gridTemplateColumns: "100px 1fr",
							gap: 12,
						}}
					>
						<div
							style={{
								fontFamily: fonts.display,
								fontStyle: "italic",
								fontSize: 14,
								color: theme.primary,
							}}
						>
							{t.name}
						</div>
						<p
							style={{
								fontFamily: fonts.body,
								fontSize: 12,
								lineHeight: 1.55,
								color: theme.textMuted,
								margin: 0,
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

function ThemeViaLine({
	analysis,
	theme,
}: {
	analysis: AnalysisContent;
	theme: ThemeConfig;
}) {
	const themes = analysis.themes ?? [];
	const lines = analysis.key_lines ?? [];
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
			{themes.map((t, i) => {
				const matched =
					lines.find((l) => {
						const text = `${l.line} ${l.insight}`.toLowerCase();
						for (const w of t.name.split(/\s+/)) {
							if (w.length >= 4 && text.includes(w.toLowerCase())) return true;
						}
						return false;
					}) ?? lines[i % lines.length];
				return (
					<div key={`${t.name}-${i}`}>
						<div
							style={{
								fontFamily: fonts.display,
								fontStyle: "italic",
								fontSize: 16,
								color: theme.text,
							}}
						>
							{t.name}
						</div>
						{matched && (
							<blockquote
								style={{
									margin: "8px 0 0",
									paddingLeft: 12,
									borderLeft: `2px solid ${theme.primary}`,
								}}
							>
								<p
									style={{
										fontFamily: fonts.display,
										fontStyle: "italic",
										fontSize: 14,
										lineHeight: 1.4,
										color: theme.text,
										margin: 0,
									}}
								>
									&ldquo;{matched.line}&rdquo;
								</p>
							</blockquote>
						)}
					</div>
				);
			})}
		</div>
	);
}

function LineViaSection({
	analysis,
	theme,
}: {
	analysis: AnalysisContent;
	theme: ThemeConfig;
}) {
	const lines = analysis.key_lines ?? [];
	const journey = analysis.journey ?? [];
	const [idx, setIdx] = useState(0);
	const safe = Math.min(idx, lines.length - 1);
	const line = lines[safe];
	const section =
		journey.length > 0
			? journey[Math.min(Math.floor((safe / lines.length) * journey.length), journey.length - 1)]
			: null;

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
			{section && (
				<div>
					<Label theme={theme}>where in the song</Label>
					<div
						style={{
							fontFamily: fonts.display,
							fontStyle: "italic",
							fontSize: 14,
							color: theme.text,
							marginTop: 2,
						}}
					>
						{section.section} · {section.mood}
					</div>
				</div>
			)}
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
						fontSize: 20,
						lineHeight: 1.4,
						color: theme.text,
						margin: 0,
					}}
				>
					&ldquo;{line.line}&rdquo;
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
					{line.insight}
				</p>
			</blockquote>
			{lines.length > 1 && (
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
					}}
				>
					<span
						style={{
							fontFamily: fonts.body,
							fontSize: 10,
							letterSpacing: "0.1em",
							color: theme.textMuted,
						}}
					>
						line {safe + 1} of {lines.length}
					</span>
					<div style={{ display: "flex", gap: 14 }}>
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

function SectionViaLine({
	analysis,
	theme,
}: {
	analysis: AnalysisContent;
	theme: ThemeConfig;
}) {
	const journey = analysis.journey ?? [];
	const lines = analysis.key_lines ?? [];
	const [idx, setIdx] = useState(0);
	const safe = Math.min(idx, journey.length - 1);
	const section = journey[safe];
	const lineHere =
		lines.length > 0
			? lines[Math.min(Math.floor((safe / journey.length) * lines.length), lines.length - 1)]
			: null;
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
				key={safe}
			>
				{section.mood}
			</div>
			<p
				style={{
					fontFamily: fonts.body,
					fontSize: 14,
					lineHeight: 1.65,
					color: theme.textMuted,
					margin: 0,
				}}
			>
				{section.description}
			</p>
			{lineHere && (
				<div>
					<Label theme={theme}>narrated by</Label>
					<blockquote
						style={{
							margin: "6px 0 0",
							paddingLeft: 12,
							borderLeft: `2px solid ${theme.primary}`,
						}}
					>
						<p
							style={{
								fontFamily: fonts.display,
								fontStyle: "italic",
								fontSize: 14,
								color: theme.text,
								margin: 0,
							}}
						>
							&ldquo;{lineHere.line}&rdquo;
						</p>
					</blockquote>
				</div>
			)}
			{journey.length > 1 && (
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
					}}
				>
					<span
						style={{
							fontFamily: fonts.body,
							fontSize: 10,
							letterSpacing: "0.1em",
							color: theme.textMuted,
						}}
					>
						section {safe + 1} of {journey.length}
					</span>
					<div style={{ display: "flex", gap: 14 }}>
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
							onClick={() => setIdx(Math.min(journey.length - 1, safe + 1))}
							disabled={safe === journey.length - 1}
							style={textBtn(theme, safe === journey.length - 1)}
						>
							next →
						</button>
					</div>
				</div>
			)}
		</div>
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
