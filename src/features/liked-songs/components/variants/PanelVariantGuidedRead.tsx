import { useState } from "react";
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

interface Beat {
	id: string;
	prompt: string;
	synthesis: React.ReactNode;
}

function buildBeats(
	analysis: AnalysisContent,
	theme: ThemeConfig,
): Beat[] {
	const beats: Beat[] = [];
	const firstTheme = analysis.themes?.[0] ?? null;
	const firstLine = analysis.key_lines?.[0] ?? null;
	const journey = analysis.journey ?? [];
	const firstSection = journey[0] ?? null;
	const lastSection = journey[journey.length - 1] ?? null;

	if (analysis.compound_mood || analysis.mood_description) {
		beats.push({
			id: "feeling",
			prompt: "What's the feeling here?",
			synthesis: (
				<>
					{analysis.compound_mood && (
						<strong
							style={{
								fontFamily: fonts.display,
								fontStyle: "italic",
								fontWeight: 400,
								color: theme.primary,
							}}
						>
							{analysis.compound_mood}
						</strong>
					)}
					{analysis.compound_mood && analysis.mood_description && " — "}
					{analysis.mood_description}
				</>
			),
		});
	}

	if (firstTheme && firstLine) {
		beats.push({
			id: "engine",
			prompt: "Where does that come from?",
			synthesis: (
				<>
					It runs on{" "}
					<strong
						style={{
							fontFamily: fonts.display,
							fontStyle: "italic",
							fontWeight: 400,
							color: theme.primary,
						}}
					>
						{firstTheme.name}
					</strong>
					, sharpest in the line{" "}
					<em style={{ color: theme.text }}>
						&ldquo;{firstLine.line}&rdquo;
					</em>
					.
				</>
			),
		});
	} else if (firstTheme) {
		beats.push({
			id: "engine",
			prompt: "Where does that come from?",
			synthesis: (
				<>
					It builds on{" "}
					<strong
						style={{
							fontFamily: fonts.display,
							fontStyle: "italic",
							fontWeight: 400,
							color: theme.primary,
						}}
					>
						{firstTheme.name}
					</strong>{" "}
					— {firstTheme.description}
				</>
			),
		});
	}

	if (firstSection && lastSection && firstSection !== lastSection) {
		beats.push({
			id: "shape",
			prompt: "How does the song carry it?",
			synthesis: (
				<>
					It opens{" "}
					<em style={{ color: theme.text }}>{firstSection.mood}</em> and lands{" "}
					<em style={{ color: theme.text }}>{lastSection.mood}</em>, across{" "}
					{journey.length} moves.
				</>
			),
		});
	} else if (firstSection) {
		beats.push({
			id: "shape",
			prompt: "How does the song carry it?",
			synthesis: (
				<>
					Across one stretch — <em>{firstSection.mood}</em>.
				</>
			),
		});
	}

	if (analysis.key_lines && analysis.key_lines.length > 1) {
		const last = analysis.key_lines[analysis.key_lines.length - 1];
		beats.push({
			id: "verdict",
			prompt: "Anything that nails it?",
			synthesis: (
				<>
					The last line gets the verdict:{" "}
					<em style={{ color: theme.text }}>&ldquo;{last.line}&rdquo;</em>{" "}
					<span
						style={{ display: "block", marginTop: 6, fontSize: 12 }}
					>
						{last.insight}
					</span>
				</>
			),
		});
	}

	if (analysis.sonic_texture) {
		beats.push({
			id: "sound",
			prompt: "What about the sound?",
			synthesis: <>{analysis.sonic_texture}</>,
		});
	}

	return beats;
}

export function PanelVariantGuidedRead({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis as AnalysisContent | undefined;
	const [step, setStep] = useState(0);
	const [accepted, setAccepted] = useState<Set<string>>(new Set());

	const beats = analysis ? buildBeats(analysis, theme) : [];
	const current = beats[step] ?? null;
	const done = step >= beats.length;

	const accept = () => {
		if (current) {
			setAccepted((prev) => new Set(prev).add(current.id));
			setStep((s) => s + 1);
		}
	};
	const skip = () => setStep((s) => s + 1);

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
						size={32}
					/>
				)}

				{beats
					.filter((b) => accepted.has(b.id))
					.map((b) => (
						<div
							key={b.id}
							style={{
								animation: "hearted-push-up 280ms ease both",
								display: "flex",
								flexDirection: "column",
								gap: 6,
								paddingTop: 14,
								borderTop: `1px solid ${theme.border}`,
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
								{b.prompt}
							</span>
							<p
								style={{
									fontFamily: fonts.body,
									fontSize: 15,
									lineHeight: 1.7,
									color: theme.text,
									margin: 0,
								}}
							>
								{b.synthesis}
							</p>
						</div>
					))}

				{current && !done && (
					<div
						key={current.id}
						style={{
							animation: "hearted-fade 220ms ease",
							display: "flex",
							flexDirection: "column",
							gap: 10,
							paddingTop: 16,
							borderTop: `1px dashed ${theme.border}`,
						}}
					>
						<p
							style={{
								fontFamily: fonts.display,
								fontStyle: "italic",
								fontSize: 18,
								color: theme.text,
								margin: 0,
							}}
						>
							{current.prompt}
						</p>
						<div style={{ display: "flex", gap: 14, marginTop: 4 }}>
							<button
								type="button"
								onClick={accept}
								style={{
									fontFamily: fonts.body,
									fontSize: 12,
									letterSpacing: "0.04em",
									padding: "8px 14px",
									background: theme.text,
									color: theme.bg,
									border: "none",
									borderRadius: 3,
									cursor: "pointer",
								}}
							>
								tell me
							</button>
							<button
								type="button"
								onClick={skip}
								style={{
									fontFamily: fonts.body,
									fontSize: 12,
									letterSpacing: "0.04em",
									background: "transparent",
									color: theme.textMuted,
									border: "none",
									padding: 0,
									cursor: "pointer",
								}}
							>
								skip →
							</button>
						</div>
					</div>
				)}

				{done && beats.length > 0 && (
					<div
						style={{
							paddingTop: 16,
							borderTop: `1px dashed ${theme.border}`,
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
						}}
					>
						<span
							style={{
								fontFamily: fonts.body,
								fontStyle: "italic",
								fontSize: 12,
								color: theme.textMuted,
							}}
						>
							That's everything.
						</span>
						<button
							type="button"
							onClick={() => {
								setStep(0);
								setAccepted(new Set());
							}}
							style={{
								background: "transparent",
								border: "none",
								padding: 0,
								cursor: "pointer",
								fontFamily: fonts.body,
								fontSize: 11,
								letterSpacing: "0.04em",
								color: theme.primary,
							}}
						>
							start over
						</button>
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
