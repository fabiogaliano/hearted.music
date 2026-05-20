import { useState } from "react";
import type { AnalysisContent, LikedSong } from "@/features/liked-songs/types";
import { fonts } from "@/lib/theme/fonts";
import { useThemeWithOverride } from "@/lib/theme/ThemeHueProvider";
import type { ThemeConfig } from "@/lib/theme/types";
import {
	GenreRow,
	JourneyDisplay,
	KeyLinesDisplay,
	MoodBlock,
	ThemesInline,
} from "./_ProdPrimitives";
import { HeroTitleBlock, VariantShell } from "./_VariantShell";

interface Props {
	song: LikedSong;
	albumArtUrl?: string;
	artistImageUrl?: string;
	isExpanded: boolean;
	onClose: () => void;
}

type Task =
	| "feel"
	| "quote"
	| "share"
	| "shape"
	| "study";

interface TaskDef {
	key: Task;
	label: string;
	rationale: string;
}

const TASKS: TaskDef[] = [
	{ key: "feel", label: "Feel the mood", rationale: "in one breath" },
	{ key: "quote", label: "Find a quote", rationale: "for sharing" },
	{ key: "share", label: "Say what it's about", rationale: "in one sentence" },
	{ key: "shape", label: "Understand the shape", rationale: "section by section" },
	{ key: "study", label: "Study the lyrics", rationale: "with insight" },
];

export function PanelVariantTaskIndex({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis as AnalysisContent | undefined;
	const [open, setOpen] = useState<Task | null>(null);

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

				<p
					style={{
						fontFamily: fonts.body,
						fontSize: 11,
						letterSpacing: "0.1em",
						textTransform: "uppercase",
						color: theme.textMuted,
						margin: 0,
					}}
				>
					I want to…
				</p>

				{!analysis ? (
					<EmptyState theme={theme} />
				) : (
					<div
						style={{ display: "flex", flexDirection: "column", gap: 0 }}
					>
						{TASKS.map((task) => {
							const isOpen = open === task.key;
							return (
								<div
									key={task.key}
									style={{ borderTop: `1px solid ${theme.border}` }}
								>
									<button
										type="button"
										onClick={() => setOpen(isOpen ? null : task.key)}
										style={{
											display: "flex",
											alignItems: "baseline",
											justifyContent: "space-between",
											width: "100%",
											padding: "14px 0",
											background: "transparent",
											border: "none",
											textAlign: "left",
											cursor: "pointer",
										}}
									>
										<span
											style={{
												fontFamily: fonts.display,
												fontSize: 18,
												color: isOpen ? theme.primary : theme.text,
												transition: "color 160ms ease",
											}}
										>
											{task.label}
										</span>
										<span
											style={{
												fontFamily: fonts.body,
												fontStyle: "italic",
												fontSize: 12,
												color: theme.textMuted,
											}}
										>
											{task.rationale}
										</span>
									</button>
									<div
										style={{
											maxHeight: isOpen ? 600 : 0,
											overflow: "hidden",
											transition: "max-height 260ms ease",
										}}
									>
										<div style={{ padding: "4px 0 18px" }}>
											<TaskBody task={task.key} analysis={analysis} theme={theme} />
										</div>
									</div>
								</div>
							);
						})}
						<div style={{ borderTop: `1px solid ${theme.border}` }} />
					</div>
				)}
			</div>
		</VariantShell>
	);
}

function TaskBody({
	task,
	analysis,
	theme,
}: {
	task: Task;
	analysis: AnalysisContent;
	theme: ThemeConfig;
}) {
	if (task === "feel") {
		return (
			<MoodBlock
				compoundMood={analysis.compound_mood}
				moodDescription={analysis.mood_description}
				theme={theme}
			/>
		);
	}
	if (task === "quote") {
		if (!analysis.key_lines?.length) return <Empty theme={theme} />;
		return (
			<KeyLinesDisplay
				keyLines={analysis.key_lines}
				theme={theme}
				showHeader={false}
			/>
		);
	}
	if (task === "share") {
		return (
			<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
				{analysis.headline && (
					<p
						style={{
							fontFamily: fonts.display,
							fontSize: 20,
							lineHeight: 1.3,
							color: theme.text,
							margin: 0,
						}}
					>
						{analysis.headline}
					</p>
				)}
				{analysis.themes && analysis.themes.length > 0 && (
					<ThemesInline themes={analysis.themes} theme={theme} />
				)}
			</div>
		);
	}
	if (task === "shape") {
		if (!analysis.journey?.length) return <Empty theme={theme} />;
		return <JourneyDisplay journey={analysis.journey} theme={theme} />;
	}
	if (task === "study") {
		return (
			<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
				{analysis.interpretation && (
					<p
						style={{
							fontFamily: fonts.body,
							fontStyle: "italic",
							fontSize: 14,
							lineHeight: 1.65,
							color: theme.textMuted,
							margin: 0,
							borderLeft: `2px solid ${theme.primary}`,
							paddingLeft: 12,
						}}
					>
						{analysis.interpretation}
					</p>
				)}
				{analysis.key_lines && analysis.key_lines.length > 0 && (
					<KeyLinesDisplay
						keyLines={analysis.key_lines}
						theme={theme}
						showHeader={false}
					/>
				)}
			</div>
		);
	}
	return null;
}

function Empty({ theme }: { theme: ThemeConfig }) {
	return (
		<p
			style={{
				fontFamily: fonts.body,
				fontStyle: "italic",
				fontSize: 13,
				color: theme.textMuted,
				margin: 0,
			}}
		>
			Nothing here yet.
		</p>
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
