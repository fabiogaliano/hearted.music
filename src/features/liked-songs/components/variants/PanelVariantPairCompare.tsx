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

interface Option {
	id: string;
	kind: "theme" | "section";
	label: string;
	body: string;
	supportingLine: { line: string; insight: string } | null;
}

function buildOptions(analysis: AnalysisContent): Option[] {
	const out: Option[] = [];
	const lines = analysis.key_lines ?? [];
	for (const t of analysis.themes ?? []) {
		const matched =
			lines.find((l) => {
				const text = `${l.line} ${l.insight}`.toLowerCase();
				for (const w of t.name.split(/\s+/)) {
					if (w.length >= 4 && text.includes(w.toLowerCase())) return true;
				}
				return false;
			}) ?? null;
		out.push({
			id: `theme:${t.name}`,
			kind: "theme",
			label: t.name,
			body: t.description,
			supportingLine: matched,
		});
	}
	const journey = analysis.journey ?? [];
	journey.forEach((j, i) => {
		const lineHere =
			lines.length > 0
				? lines[Math.min(Math.floor((i / journey.length) * lines.length), lines.length - 1)]
				: null;
		out.push({
			id: `section:${j.section}:${i}`,
			kind: "section",
			label: `${j.section} · ${j.mood}`,
			body: j.description,
			supportingLine: lineHere,
		});
	});
	return out;
}

export function PanelVariantPairCompare({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis as AnalysisContent | undefined;

	const options = useMemo(
		() => (analysis ? buildOptions(analysis) : []),
		[analysis],
	);

	const [aId, setAId] = useState<string | null>(options[0]?.id ?? null);
	const [bId, setBId] = useState<string | null>(options[1]?.id ?? null);

	const a = options.find((o) => o.id === aId) ?? null;
	const b = options.find((o) => o.id === bId) ?? null;

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

				{options.length >= 2 && (
					<>
						<div
							style={{
								display: "grid",
								gridTemplateColumns: "1fr 1fr",
								gap: 12,
							}}
						>
							<Picker
								label="Left"
								options={options}
								value={aId}
								onChange={setAId}
								theme={theme}
							/>
							<Picker
								label="Right"
								options={options}
								value={bId}
								onChange={setBId}
								theme={theme}
							/>
						</div>

						{a && b && (
							<>
								<div
									style={{
										display: "grid",
										gridTemplateColumns: "1fr 1fr",
										gap: 12,
										animation: "hearted-fade 240ms ease",
									}}
									key={`${aId}-${bId}`}
								>
									<Column option={a} theme={theme} />
									<Column option={b} theme={theme} />
								</div>
								{a.id !== b.id && (
									<div
										style={{
											padding: "14px 16px",
											background: theme.surface,
											borderRadius: 4,
											display: "flex",
											flexDirection: "column",
											gap: 6,
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
											held side-by-side
										</span>
										<p
											style={{
												fontFamily: fonts.display,
												fontStyle: "italic",
												fontSize: 14,
												lineHeight: 1.55,
												color: theme.text,
												margin: 0,
											}}
										>
											{a.kind === b.kind
												? a.kind === "theme"
													? "Two themes in tension — the song holds both."
													: "Two moments — one becomes the other."
												: "A theme meets the moment it lives in."}
										</p>
									</div>
								)}
							</>
						)}
					</>
				)}
			</div>
		</VariantShell>
	);
}

function Picker({
	label,
	options,
	value,
	onChange,
	theme,
}: {
	label: string;
	options: Option[];
	value: string | null;
	onChange: (id: string) => void;
	theme: ThemeConfig;
}) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
			<span
				style={{
					fontFamily: fonts.body,
					fontSize: 9,
					letterSpacing: "0.12em",
					textTransform: "uppercase",
					color: theme.textMuted,
				}}
			>
				{label}
			</span>
			<select
				value={value ?? ""}
				onChange={(e) => onChange(e.target.value)}
				style={{
					background: "transparent",
					border: `1px solid ${theme.border}`,
					borderRadius: 4,
					padding: "8px 10px",
					fontFamily: fonts.body,
					fontSize: 12,
					color: theme.text,
					cursor: "pointer",
				}}
			>
				{options.map((o) => (
					<option key={o.id} value={o.id}>
						{o.kind === "theme" ? "theme · " : "section · "}
						{o.label}
					</option>
				))}
			</select>
		</div>
	);
}

function Column({ option, theme }: { option: Option; theme: ThemeConfig }) {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 10,
				padding: 14,
				border: `1px solid ${theme.border}`,
				borderRadius: 4,
			}}
		>
			<span
				style={{
					fontFamily: fonts.body,
					fontSize: 9,
					letterSpacing: "0.12em",
					textTransform: "uppercase",
					color: theme.primary,
				}}
			>
				{option.kind}
			</span>
			<div
				style={{
					fontFamily: fonts.display,
					fontStyle: "italic",
					fontSize: 16,
					lineHeight: 1.3,
					color: theme.text,
				}}
			>
				{option.label}
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
				{option.body}
			</p>
			{option.supportingLine && (
				<blockquote
					style={{
						margin: 0,
						paddingLeft: 10,
						borderLeft: `2px solid ${theme.primary}`,
					}}
				>
					<p
						style={{
							fontFamily: fonts.display,
							fontStyle: "italic",
							fontSize: 12,
							lineHeight: 1.4,
							color: theme.text,
							margin: 0,
						}}
					>
						&ldquo;{option.supportingLine.line}&rdquo;
					</p>
				</blockquote>
			)}
		</div>
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
