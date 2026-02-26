import React, { useRef, useState, useEffect, useCallback } from "react";
import { fonts } from "@/lib/theme/fonts";
import { themes } from "@/lib/theme/colors";
import { extractHue } from "@/lib/utils/color";
import type { DesignConfig, ColorProps, PlaygroundSong } from "./types";
import { HEADLINE_SIZES } from "./types";
import { GenreDisplay } from "./GenreDisplay";
import { KeyLinesSection } from "./KeyLinesSection";
import { HorizontalJourney } from "./HorizontalJourney";

interface PanelPrototypeProps {
	song: PlaygroundSong;
	config: DesignConfig;
}

const PLAYGROUND_KEYFRAMES = `
	@keyframes hearted-slide-fwd {
		from { opacity: 0; transform: translateX(12px); }
		to { opacity: 1; transform: translateX(0); }
	}
	@keyframes hearted-slide-back {
		from { opacity: 0; transform: translateX(-12px); }
		to { opacity: 1; transform: translateX(0); }
	}
	@keyframes hearted-fade {
		from { opacity: 0; }
		to { opacity: 1; }
	}
	@keyframes hearted-push-up {
		from { opacity: 0; transform: translateY(14px); }
		to { opacity: 1; transform: translateY(0); }
	}
	@keyframes hearted-push-down {
		from { opacity: 0; transform: translateY(-14px); }
		to { opacity: 1; transform: translateY(0); }
	}
	@keyframes hearted-scan {
		from { background-position: -60% 0; }
		to   { background-position: 160% 0; }
	}
	@keyframes hearted-tick-pulse {
		from { transform: scaleY(0.68); }
		to   { transform: scaleY(1); }
	}
`;

function getColors(config: DesignConfig): ColorProps {
	const baseTheme = themes[config.themeColor];
	const hue = extractHue(baseTheme.primary);

	if (config.isDark) {
		return {
			bg: `hsl(${hue}, 18%, 8%)`,
			surface: `hsl(${hue}, 14%, 14%)`,
			surfaceHover: `hsl(${hue}, 16%, 18%)`,
			border: `hsl(${hue}, 12%, 22%)`,
			text: `hsl(${hue}, 12%, 94%)`,
			textMuted: `hsl(${hue}, 10%, 65%)`,
			textDim: `hsl(${hue}, 8%, 45%)`,
			accent: `hsl(${hue}, 50%, 65%)`,
			accentMuted: `hsl(${hue}, 35%, 50%)`,
		};
	}

	return {
		bg: baseTheme.bg,
		surface: baseTheme.surface,
		surfaceHover: baseTheme.surfaceDim,
		border: baseTheme.border,
		text: baseTheme.text,
		textMuted: baseTheme.textMuted,
		textDim: baseTheme.textMuted,
		accent: baseTheme.primary,
		accentMuted: baseTheme.primaryHover,
	};
}

// ─── Section header shared style ─────────────────────────────────────────────

function SectionHeader({
	label,
	colors,
}: {
	label: string;
	colors: ColorProps;
}) {
	return (
		<h3
			style={{
				fontFamily: fonts.body,
				fontSize: 10,
				fontWeight: 500,
				letterSpacing: "0.08em",
				textTransform: "uppercase",
				color: colors.textDim,
			}}
		>
			{label}
		</h3>
	);
}

// ─── Journey: Vertical (existing) ────────────────────────────────────────────

function VerticalJourney({
	journey,
	colors,
}: {
	journey: PlaygroundSong["analysis"]["journey"];
	colors: ColorProps;
}) {
	return (
		<div className="space-y-3">
			<SectionHeader label="The Journey" colors={colors} />
			<div className="space-y-2.5">
				{journey.map((segment, i) => (
					<div key={i} className="flex gap-3">
						<div
							className="shrink-0 w-16 pt-0.5"
							style={{
								fontFamily: fonts.body,
								fontSize: 9,
								fontWeight: 500,
								letterSpacing: "0.06em",
								textTransform: "uppercase",
								color: colors.textDim,
							}}
						>
							{segment.section}
						</div>
						<div className="flex-1 min-w-0">
							<div
								style={{
									fontFamily: fonts.body,
									fontSize: 13,
									fontWeight: 500,
									color: colors.text,
									marginBottom: 2,
								}}
							>
								{segment.mood}
							</div>
							<div
								style={{
									fontFamily: fonts.body,
									fontSize: 12,
									lineHeight: 1.4,
									color: colors.textMuted,
								}}
							>
								{segment.description}
							</div>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

// ─── Journey: Timeline (zigzag alternating center axis) ──────────────────────

function JourneyTimeline({
	journey,
	colors,
}: {
	journey: PlaygroundSong["analysis"]["journey"];
	colors: ColorProps;
}) {
	const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

	return (
		<div className="space-y-3">
			<SectionHeader label="Emotional Arc" colors={colors} />
			<div className="relative">
				{/* Center vertical line */}
				<div
					className="absolute top-0 bottom-0"
					style={{
						left: "50%",
						width: 1,
						background: colors.border,
						transform: "translateX(-50%)",
					}}
				/>

				<div className="space-y-2">
					{journey.map((seg, i) => {
						const isLeft = i % 2 === 0;
						const isExpanded = expandedIndex === i;

						return (
							<div
								key={i}
								className="flex items-start"
								style={{ minHeight: 32 }}
							>
								{/* Left slot */}
								<div
									style={{
										flex: 1,
										paddingRight: 12,
										textAlign: isLeft ? "right" : "left",
									}}
								>
									{isLeft && (
										<button
											type="button"
											className="cursor-pointer w-full text-right"
											onClick={() => setExpandedIndex(isExpanded ? null : i)}
										>
											<span
												style={{
													fontFamily: fonts.display,
													fontSize: 13,
													fontWeight: 400,
													color: isExpanded ? colors.accent : colors.text,
													display: "block",
													transition: "color 200ms",
												}}
											>
												{seg.mood}
											</span>
											<span
												style={{
													fontFamily: fonts.body,
													fontSize: 9,
													letterSpacing: "0.06em",
													textTransform: "uppercase",
													color: colors.textDim,
													display: "block",
													marginTop: 1,
												}}
											>
												{seg.section}
											</span>
											{isExpanded && (
												<p
													style={{
														fontFamily: fonts.body,
														fontSize: 11,
														lineHeight: 1.45,
														color: colors.textMuted,
														marginTop: 4,
														animation: "hearted-fade 150ms ease forwards",
													}}
												>
													{seg.description}
												</p>
											)}
										</button>
									)}
								</div>

								{/* Center dot */}
								<div
									style={{
										width: 20,
										display: "flex",
										flexDirection: "column",
										alignItems: "center",
										paddingTop: 4,
										flexShrink: 0,
										position: "relative",
										zIndex: 1,
									}}
								>
									<div
										style={{
											width: isExpanded ? 10 : 7,
											height: isExpanded ? 10 : 7,
											borderRadius: "50%",
											background: isExpanded ? colors.accent : colors.border,
											border: `1px solid ${isExpanded ? colors.accent : colors.border}`,
											transition: "all 200ms ease",
										}}
									/>
								</div>

								{/* Right slot */}
								<div style={{ flex: 1, paddingLeft: 12 }}>
									{!isLeft && (
										<button
											type="button"
											className="cursor-pointer w-full text-left"
											onClick={() => setExpandedIndex(isExpanded ? null : i)}
										>
											<span
												style={{
													fontFamily: fonts.display,
													fontSize: 13,
													fontWeight: 400,
													color: isExpanded ? colors.accent : colors.text,
													display: "block",
													transition: "color 200ms",
												}}
											>
												{seg.mood}
											</span>
											<span
												style={{
													fontFamily: fonts.body,
													fontSize: 9,
													letterSpacing: "0.06em",
													textTransform: "uppercase",
													color: colors.textDim,
													display: "block",
													marginTop: 1,
												}}
											>
												{seg.section}
											</span>
											{isExpanded && (
												<p
													style={{
														fontFamily: fonts.body,
														fontSize: 11,
														lineHeight: 1.45,
														color: colors.textMuted,
														marginTop: 4,
														animation: "hearted-fade 150ms ease forwards",
													}}
												>
													{seg.description}
												</p>
											)}
										</button>
									)}
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}

// ─── Themes: List (hover/click expand) ───────────────────────────────────────

function ThemesList({
	analysisThemes,
	colors,
}: {
	analysisThemes: PlaygroundSong["analysis"]["themes"];
	colors: ColorProps;
}) {
	const [openIndex, setOpenIndex] = useState(-1);
	const [pinnedIndex, setPinnedIndex] = useState(-1);
	const closeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

	const handleHover = (index: number) => {
		if (closeTimeout.current) clearTimeout(closeTimeout.current);
		if (pinnedIndex === -1) setOpenIndex(index);
	};

	const handleClick = (index: number) => {
		if (pinnedIndex === index) {
			setPinnedIndex(-1);
			setOpenIndex(-1);
		} else {
			setPinnedIndex(index);
			setOpenIndex(index);
		}
	};

	const handleLeave = () => {
		if (pinnedIndex !== -1) return;
		closeTimeout.current = setTimeout(() => setOpenIndex(-1), 150);
	};

	return (
		<div className="space-y-3">
			<SectionHeader label="What It's About" colors={colors} />
			<section onMouseLeave={handleLeave}>
				{analysisThemes.map((theme, i) => {
					const isOpen = openIndex === i;
					return (
						<div
							key={i}
							className="cursor-pointer py-1.5"
							onMouseEnter={() => handleHover(i)}
							onClick={() => handleClick(i)}
						>
							<div className="flex items-center gap-2">
								<span
									style={{
										fontFamily: fonts.body,
										fontSize: 13,
										fontWeight: 500,
										color: colors.text,
									}}
								>
									{theme.name}
								</span>
								<span
									style={{
										fontSize: 10,
										color: colors.textDim,
										opacity: isOpen ? 0 : 0.5,
										transition: "opacity 200ms",
									}}
								>
									↓
								</span>
							</div>
							<div
								className="overflow-hidden transition-all duration-200"
								style={{
									maxHeight: isOpen ? 100 : 0,
									opacity: isOpen ? 1 : 0,
									marginTop: isOpen ? 4 : 0,
								}}
							>
								<p
									style={{
										fontFamily: fonts.body,
										fontSize: 12,
										lineHeight: 1.4,
										color: colors.textMuted,
									}}
								>
									{theme.description}
								</p>
							</div>
						</div>
					);
				})}
			</section>
		</div>
	);
}

// ─── Themes: Pills ────────────────────────────────────────────────────────────

function ThemesPills({
	analysisThemes,
	colors,
}: {
	analysisThemes: PlaygroundSong["analysis"]["themes"];
	colors: ColorProps;
}) {
	return (
		<div className="flex flex-wrap gap-1.5">
			{analysisThemes.map((theme, i) => (
				<span
					key={i}
					style={{
						fontFamily: fonts.body,
						fontSize: 11,
						color: colors.textMuted,
						background: "transparent",
						border: `1px solid ${colors.border}`,
						borderRadius: 24,
						padding: "3px 10px",
					}}
				>
					{theme.name}
				</span>
			))}
		</div>
	);
}

// ─── Themes: Prose ────────────────────────────────────────────────────────────

function ThemesProse({
	analysisThemes,
	colors,
}: {
	analysisThemes: PlaygroundSong["analysis"]["themes"];
	colors: ColorProps;
}) {
	const names = analysisThemes.map((t) => t.name);
	let prose = "";
	if (names.length === 1) {
		prose = `About ${names[0]}.`;
	} else if (names.length === 2) {
		prose = `About ${names[0]} and ${names[1]}.`;
	} else if (names.length > 2) {
		const last = names[names.length - 1];
		const rest = names.slice(0, -1).join(", ");
		prose = `About ${rest}, and ${last}.`;
	}

	return (
		<div className="space-y-2">
			<SectionHeader label="What It's About" colors={colors} />
			<p
				style={{
					fontFamily: fonts.body,
					fontSize: 13,
					lineHeight: 1.55,
					color: colors.textMuted,
				}}
			>
				{prose}
			</p>
		</div>
	);
}

// ─── Key Lines: Stacked (display font, no left border) ───────────────────────

function StackedKeyLines({
	keyLines,
	colors,
}: {
	keyLines: PlaygroundSong["analysis"]["key_lines"];
	colors: ColorProps;
}) {
	const [openIndex, setOpenIndex] = useState<number>(-1);
	const [pinnedIndex, setPinnedIndex] = useState<number>(-1);
	const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const handleHover = useCallback(
		(index: number) => {
			if (closeTimeoutRef.current) {
				clearTimeout(closeTimeoutRef.current);
				closeTimeoutRef.current = null;
			}
			if (pinnedIndex === -1) setOpenIndex(index);
		},
		[pinnedIndex],
	);

	const handleClick = useCallback(
		(index: number) => {
			if (pinnedIndex === index) {
				setPinnedIndex(-1);
				setOpenIndex(-1);
			} else {
				setPinnedIndex(index);
				setOpenIndex(index);
			}
		},
		[pinnedIndex],
	);

	const handleListLeave = useCallback(() => {
		if (pinnedIndex === -1) {
			closeTimeoutRef.current = setTimeout(() => setOpenIndex(-1), 150);
		}
	}, [pinnedIndex]);

	return (
		<div className="space-y-3">
			<SectionHeader label="Key Lines" colors={colors} />
			<div className="space-y-4" onMouseLeave={handleListLeave}>
				{keyLines.map((kl, i) => {
					const isOpen = openIndex === i;
					return (
						<div
							key={i}
							style={{
								paddingBottom: i < keyLines.length - 1 ? 16 : 0,
								borderBottom:
									i < keyLines.length - 1
										? `1px solid ${colors.border}`
										: "none",
								cursor: "pointer",
							}}
							onMouseEnter={() => handleHover(i)}
							onClick={() => handleClick(i)}
						>
							<div
								style={{
									display: "flex",
									alignItems: "baseline",
									justifyContent: "space-between",
								}}
							>
								<p
									style={{
										fontFamily: fonts.display,
										fontStyle: "italic",
										fontSize: 15,
										lineHeight: 1.5,
										color: isOpen ? colors.text : colors.textMuted,
										transition: "color 200ms ease",
									}}
								>
									"{kl.line}"
								</p>
								<span
									style={{
										fontFamily: fonts.body,
										fontSize: 10,
										color: colors.accent,
										opacity: isOpen ? 0 : 0.5,
										marginLeft: 8,
										flexShrink: 0,
										transition: "opacity 180ms ease",
									}}
								>
									↓
								</span>
							</div>
							<div
								style={{
									maxHeight: isOpen ? 120 : 0,
									opacity: isOpen ? 1 : 0,
									overflow: "hidden",
									marginTop: isOpen ? 6 : 0,
									paddingLeft: 8,
									transition:
										"max-height 220ms ease, opacity 180ms ease, margin-top 220ms ease",
								}}
							>
								<p
									style={{
										fontFamily: fonts.body,
										fontSize: 12,
										lineHeight: 1.5,
										color: colors.textMuted,
									}}
								>
									{kl.insight}
								</p>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

// ─── Key Lines: Focused (one at a time, navigable) ───────────────────────────

function FocusedKeyLines({
	keyLines,
	colors,
}: {
	keyLines: PlaygroundSong["analysis"]["key_lines"];
	colors: ColorProps;
}) {
	const [index, setIndex] = useState(0);
	const [dir, setDir] = useState<"forward" | "back">("forward");
	const [animKey, setAnimKey] = useState(0);

	const canPrev = index > 0;
	const canNext = index < keyLines.length - 1;
	const current = keyLines[index];
	const animName =
		dir === "forward" ? "hearted-slide-fwd" : "hearted-slide-back";

	const go = (direction: 1 | -1) => {
		const next = index + direction;
		if (next < 0 || next >= keyLines.length) return;
		setDir(direction === 1 ? "forward" : "back");
		setIndex(next);
		setAnimKey((k) => k + 1);
	};

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<SectionHeader label="Key Lines" colors={colors} />
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => go(-1)}
						disabled={!canPrev}
						style={{
							background: "transparent",
							border: "none",
							color: canPrev ? colors.textMuted : colors.textDim,
							opacity: canPrev ? 1 : 0.35,
							cursor: canPrev ? "pointer" : "default",
							fontSize: 12,
							padding: "0 2px",
						}}
					>
						←
					</button>
					<span
						style={{
							fontFamily: fonts.body,
							fontSize: 10,
							color: colors.textDim,
						}}
					>
						{index + 1} / {keyLines.length}
					</span>
					<button
						type="button"
						onClick={() => go(1)}
						disabled={!canNext}
						style={{
							background: "transparent",
							border: "none",
							color: canNext ? colors.textMuted : colors.textDim,
							opacity: canNext ? 1 : 0.35,
							cursor: canNext ? "pointer" : "default",
							fontSize: 12,
							padding: "0 2px",
						}}
					>
						→
					</button>
				</div>
			</div>

			<div
				key={animKey}
				className="space-y-2"
				style={{ animation: `${animName} 200ms ease forwards` }}
			>
				<p
					style={{
						fontFamily: fonts.display,
						fontStyle: "italic",
						fontSize: 16,
						lineHeight: 1.5,
						color: colors.text,
					}}
				>
					"{current.line}"
				</p>
				<p
					style={{
						fontFamily: fonts.body,
						fontSize: 12,
						lineHeight: 1.45,
						color: colors.textMuted,
					}}
				>
					{current.insight}
				</p>
			</div>
		</div>
	);
}

// ─── Audio Stats ──────────────────────────────────────────────────────────────

function AudioStats({
	features,
	colors,
}: {
	features: PlaygroundSong["audio_features"];
	colors: ColorProps;
}) {
	const energyLabel =
		features.energy >= 0.7
			? "High Energy"
			: features.energy >= 0.4
				? "Mid Energy"
				: "Low Energy";
	const valenceLabel =
		features.valence >= 0.6
			? "Bright"
			: features.valence >= 0.4
				? "Balanced"
				: "Melancholic";

	return (
		<div
			className="flex items-center gap-2"
			style={{
				fontFamily: fonts.body,
				fontSize: 10,
				color: colors.textDim,
				letterSpacing: "0.02em",
			}}
		>
			<span>{Math.round(features.tempo)} BPM</span>
			<span>·</span>
			<span>{energyLabel}</span>
			<span>·</span>
			<span>{valenceLabel}</span>
		</div>
	);
}

// ─── Headline with reveal variations ─────────────────────────────────────────

function HeadlineReveal({
	headline,
	interpretation,
	variant,
	headlineSize,
	colors,
}: {
	headline: string;
	interpretation: string;
	variant: DesignConfig["headlineReveal"];
	headlineSize: DesignConfig["headlineSize"];
	colors: ColorProps;
}) {
	const [active, setActive] = useState(false);
	const [animKey, setAnimKey] = useState(0);
	const [hovered, setHovered] = useState(false);

	const hl: React.CSSProperties = {
		fontFamily: fonts.display,
		fontSize: HEADLINE_SIZES[headlineSize],
		fontWeight: 400,
		lineHeight: 1.35,
		color: colors.text,
	};

	const ip: React.CSSProperties = {
		fontFamily: fonts.body,
		fontSize: 16,
		lineHeight: 1.55,
		color: colors.textMuted,
		borderLeft: `2px solid ${colors.accent}`,
		paddingLeft: 12,
		fontStyle: "italic",
	};

	const hintStyle = (isHovered: boolean): React.CSSProperties => ({
		fontFamily: fonts.body,
		fontSize: 10,
		letterSpacing: "0.04em",
		color: colors.textDim,
		opacity: isHovered ? 1 : 0,
		marginTop: 5,
		display: "block",
		transition: "color 200ms ease",
	});

	// ── swap: crossfade replace in same space ─────────────────────────────────
	if (variant === "swap") {
		const toggle = () => {
			setActive((a) => !a);
			setAnimKey((k) => k + 1);
		};
		return (
			<div
				onClick={toggle}
				onMouseEnter={() => setHovered(true)}
				onMouseLeave={() => setHovered(false)}
				className="cursor-pointer select-none"
			>
				<div
					key={animKey}
					style={{ animation: "hearted-fade 250ms ease forwards" }}
				>
					{active ? (
						<p style={ip}>{interpretation}</p>
					) : (
						<p
							style={{
								...hl,
								color: hovered ? colors.accent : colors.text,
								transition: "color 200ms ease",
							}}
						>
							{headline}
						</p>
					)}
				</div>
				<span style={hintStyle(hovered)}>
					{active ? "← back" : "read deeper →"}
				</span>
			</div>
		);
	}

	// ── push: directional slide — up to reveal, down to restore ──────────────
	const toggle = () => {
		setActive((a) => !a);
		setAnimKey((k) => k + 1);
	};
	const anim = active ? "hearted-push-up" : "hearted-push-down";
	return (
		<div
			onClick={toggle}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			className="cursor-pointer select-none"
			style={{ overflow: "hidden" }}
		>
			<div key={animKey} style={{ animation: `${anim} 280ms ease forwards` }}>
				{active ? (
					<p style={ip}>{interpretation}</p>
				) : (
					<p
						style={{
							...hl,
							opacity: hovered ? 0.7 : 1,
							transition: "opacity 200ms ease",
						}}
					>
						{headline}
					</p>
				)}
			</div>
			<span style={hintStyle(hovered)}>
				{active ? "← back" : "read deeper →"}
			</span>
		</div>
	);
}

// ─── Themes: positional renderer ─────────────────────────────────────────────

function ThemesBlock({
	config,
	themes,
	colors,
}: {
	config: DesignConfig;
	themes: PlaygroundSong["analysis"]["themes"];
	colors: ColorProps;
}) {
	if (config.themesStyle === "list")
		return <ThemesList analysisThemes={themes} colors={colors} />;
	if (config.themesStyle === "pills")
		return <ThemesPills analysisThemes={themes} colors={colors} />;
	if (config.themesStyle === "prose")
		return <ThemesProse analysisThemes={themes} colors={colors} />;
	return null;
}

// ─── Main PanelPrototype ─────────────────────────────────────────────────────

export function PanelPrototype({ song, config }: PanelPrototypeProps) {
	const colors = getColors(config);
	const { analysis, audio_features } = song;

	// Inject animation keyframes once into document head
	useEffect(() => {
		const id = "hearted-playground-keyframes";
		if (!document.getElementById(id)) {
			const style = document.createElement("style");
			style.id = id;
			style.textContent = PLAYGROUND_KEYFRAMES;
			document.head.appendChild(style);
		}
	}, []);

	return (
		<div
			className="w-[clamp(380px,45vw,580px)] overflow-hidden shadow-2xl"
			style={{ background: colors.bg }}
		>
			{/* Hero Zone */}
			<div className="relative h-[280px] overflow-hidden">
				<div
					className="absolute inset-0 bg-cover bg-center"
					style={{ backgroundImage: `url(${song.artistImageUrl})` }}
				/>
				<div
					className="absolute inset-0"
					style={{
						background: `linear-gradient(to bottom, transparent 30%, ${colors.bg} 100%)`,
					}}
				/>

				{/* Themes: hero overlay — top-left of cover */}
				{config.themes &&
					analysis.themes.length > 0 &&
					config.themesPosition === "hero" && (
						<div
							className="absolute top-4 left-5 flex flex-wrap gap-x-2 gap-y-1"
							style={{ maxWidth: "70%" }}
						>
							{analysis.themes.map((t) => (
								<span
									key={t.name}
									style={{
										fontFamily: fonts.body,
										fontSize: 9,
										fontWeight: 500,
										letterSpacing: "0.1em",
										textTransform: "uppercase",
										color: "hsla(0, 0%, 100%, 0.55)",
									}}
								>
									{t.name}
								</span>
							))}
						</div>
					)}

				{/* Album art + title block */}
				<div className="absolute bottom-4 left-5 right-5 flex items-end gap-3.5">
					<img
						src={song.albumArtUrl}
						alt={song.album}
						className="w-20 h-20 shadow-lg shrink-0"
					/>
					<div className="min-w-0 pb-0.5">
						<h1
							style={{
								fontFamily: fonts.display,
								fontSize: 22,
								fontWeight: 400,
								color: config.isDark ? "hsl(0, 0%, 96%)" : "hsl(0, 0%, 10%)",
								lineHeight: 1.2,
								marginBottom: 2,
							}}
						>
							{song.name}
						</h1>
						<p
							style={{
								fontFamily: fonts.body,
								fontSize: 12,
								color: config.isDark
									? "hsla(0, 0%, 100%, 0.7)"
									: "hsla(0, 0%, 0%, 0.6)",
							}}
						>
							{song.artist} · {song.album}
						</p>
					</div>
				</div>
			</div>

			{/* Content Area */}
			<div className="px-5 pt-3 pb-6 space-y-5">
				{/* Hero-positioned metadata row */}
				{config.sonicTexture ? (
					<SonicSection
						genres={song.genres}
						features={audio_features}
						sonicTexture={analysis.sonic_texture}
						style={config.sonicTextureStyle}
						colors={colors}
						showBorder={false}
						themesAboveStats={
							config.themes &&
							analysis.themes.length > 0 &&
							config.themesPosition === "above-stats"
								? analysis.themes.map((t) => t.name)
								: undefined
						}
					/>
				) : (
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							{config.genres && config.genrePosition === "hero" && (
								<GenreDisplay genres={song.genres} colors={colors} />
							)}
						</div>
						{config.audioStats && config.audioPosition === "hero" && (
							<AudioStats features={audio_features} colors={colors} />
						)}
					</div>
				)}

				{/* Compound Mood: Large style — display font, mood as visual hero */}
				{config.compoundMood && config.moodStyle === "large" && (
					<p
						style={{
							fontFamily: fonts.display,
							fontSize: 34,
							fontWeight: 300,
							lineHeight: 1.1,
							color: colors.text,
						}}
					>
						{analysis.compound_mood}
					</p>
				)}

				{/* Themes: kicker — dot-separated small caps line above headline */}
				{config.themes &&
					analysis.themes.length > 0 &&
					config.themesPosition === "kicker" && (
						<p
							style={{
								fontFamily: fonts.body,
								fontSize: 9,
								fontWeight: 500,
								letterSpacing: "0.12em",
								textTransform: "uppercase",
								color: colors.accent,
								opacity: 0.8,
							}}
						>
							{analysis.themes.map((t) => t.name).join(" \u00b7 ")}
						</p>
					)}
				{/* Themes: above-headline slot */}
				{config.themes &&
					analysis.themes.length > 0 &&
					config.themesPosition === "above-headline" && (
						<ThemesBlock
							config={config}
							themes={analysis.themes}
							colors={colors}
						/>
					)}

				{/* Headline */}
				{config.headline && (
					<HeadlineReveal
						headline={analysis.headline}
						interpretation={analysis.interpretation}
						variant={config.headlineReveal}
						headlineSize={config.headlineSize}
						colors={colors}
					/>
				)}

				{/* Themes: below-headline slot */}
				{config.themes &&
					analysis.themes.length > 0 &&
					config.themesPosition === "below-headline" && (
						<ThemesBlock
							config={config}
							themes={analysis.themes}
							colors={colors}
						/>
					)}

				{/* Journey */}
				{config.journey && analysis.journey.length > 0 && (
					<>
						{config.journeyStyle === "stepper" && (
							<HorizontalJourney journey={analysis.journey} colors={colors} />
						)}
						{config.journeyStyle === "timeline" && (
							<JourneyTimeline journey={analysis.journey} colors={colors} />
						)}
						{config.journeyStyle === "vertical" && (
							<VerticalJourney journey={analysis.journey} colors={colors} />
						)}
					</>
				)}

				{/* Genre in content position */}
				{config.genres && config.genrePosition === "content" && (
					<GenreDisplay genres={song.genres} colors={colors} />
				)}

				{/* Audio stats in content position */}
				{config.audioStats && config.audioPosition === "content" && (
					<AudioStats features={audio_features} colors={colors} />
				)}

				{/* Interpretation: Paragraph style */}
				{config.interpretation &&
					config.interpretationStyle === "paragraph" && (
						<div className="space-y-2">
							<SectionHeader label="Interpretation" colors={colors} />
							<p
								style={{
									fontFamily: fonts.body,
									fontSize: 13,
									lineHeight: 1.6,
									color: colors.textMuted,
								}}
							>
								{analysis.interpretation}
							</p>
						</div>
					)}

				{/* Interpretation: Pullquote style — display font, editorial weight */}
				{config.interpretation &&
					config.interpretationStyle === "pullquote" && (
						<div
							style={{
								borderLeft: `2px solid ${colors.accent}`,
								paddingLeft: 14,
							}}
						>
							<p
								style={{
									fontFamily: fonts.display,
									fontStyle: "italic",
									fontSize: 14,
									lineHeight: 1.7,
									color: colors.textMuted,
								}}
							>
								{analysis.interpretation}
							</p>
						</div>
					)}

				{/* Themes: bottom slot (default position alongside list/prose) */}
				{config.themes &&
					analysis.themes.length > 0 &&
					config.themesPosition === "bottom" && (
						<ThemesBlock
							config={config}
							themes={analysis.themes}
							colors={colors}
						/>
					)}

				{/* Key Lines */}
				{config.keyLines && analysis.key_lines.length > 0 && (
					<>
						{config.keyLinesStyle === "blockquote" && (
							<KeyLinesSection keyLines={analysis.key_lines} colors={colors} />
						)}
						{config.keyLinesStyle === "stacked" && (
							<StackedKeyLines keyLines={analysis.key_lines} colors={colors} />
						)}
						{config.keyLinesStyle === "focused" && (
							<FocusedKeyLines keyLines={analysis.key_lines} colors={colors} />
						)}
					</>
				)}

				{/* Footer: mood summary — separated from main content */}
				{(config.compoundMood || config.moodDescription) && (
					<div
						className="space-y-2"
						style={{
							borderTop: `1px solid ${colors.border}`,
							paddingTop: 20,
							marginTop: 8,
						}}
					>
						{config.compoundMood && config.moodStyle === "label" && (
							<span
								style={{
									fontFamily: fonts.body,
									fontSize: 10,
									fontWeight: 500,
									letterSpacing: "0.1em",
									textTransform: "uppercase",
									color: colors.accent,
									display: "block",
								}}
							>
								{analysis.compound_mood}
							</span>
						)}
						{config.moodDescription && (
							<p
								style={{
									fontFamily: fonts.body,
									fontStyle: "italic",
									fontSize: 13,
									lineHeight: 1.6,
									color: colors.textMuted,
								}}
							>
								{analysis.mood_description}
							</p>
						)}
						{config.themes &&
							analysis.themes.length > 0 &&
							config.themesPosition === "after-mood" && (
								<ThemesBlock
									config={config}
									themes={analysis.themes}
									colors={colors}
								/>
							)}
					</div>
				)}
			</div>
		</div>
	);
}

// ─── Sonic Section ────────────────────────────────────────────────────────────

function SonicSection({
	genres,
	features,
	sonicTexture,
	style,
	colors,
	showBorder = true,
	themesAboveStats,
}: {
	genres: string[];
	features: PlaygroundSong["audio_features"];
	sonicTexture: string;
	style: DesignConfig["sonicTextureStyle"];
	colors: ColorProps;
	showBorder?: boolean;
	themesAboveStats?: string[];
}) {
	const [active, setActive] = useState(false);
	const [hovered, setHovered] = useState(false);
	const [hoveredGenre, setHoveredGenre] = useState(false);
	const [animKey, setAnimKey] = useState(0);

	const energyLabel =
		features.energy >= 0.7
			? "High Energy"
			: features.energy >= 0.4
				? "Mid Energy"
				: "Low Energy";
	const valenceLabel =
		features.valence >= 0.6
			? "Bright"
			: features.valence >= 0.4
				? "Balanced"
				: "Melancholic";
	const bpm = Math.round(features.tempo);
	const [primaryGenre, ...restGenres] = genres;

	// Whisper extract: first phrase before comma or period, capped at 48 chars
	const whisperPhrase = (() => {
		const phrase = sonicTexture.split(/[.,]/)[0]?.trim() ?? sonicTexture;
		return phrase.length > 48 ? phrase.slice(0, 48) + "…" : phrase;
	})();

	const toggle = () => {
		setActive((a) => !a);
		setAnimKey((k) => k + 1);
	};

	const textureText: React.CSSProperties = {
		fontFamily: fonts.body,
		fontSize: 12,
		lineHeight: 1.55,
		color: colors.textMuted,
	};

	const triggerPill = (isHovered: boolean): React.CSSProperties => ({
		fontFamily: fonts.body,
		fontSize: 10,
		letterSpacing: "0.04em",
		color: isHovered ? colors.text : colors.accent,
		marginTop: 8,
		display: "inline-block",
		border: `1px solid ${colors.accentMuted}`,
		borderRadius: 20,
		padding: "3px 10px",
		transition: "color 180ms ease, background 180ms ease",
		background: isHovered ? colors.surface : "transparent",
		cursor: "pointer",
	});

	const genreNodes = genres.map((g, i) => (
		<span
			key={g}
			style={{
				fontFamily: fonts.body,
				fontSize: 11,
				color: colors.textMuted,
				letterSpacing: "0.02em",
				opacity: i === 0 ? 1 : 0.4,
			}}
		>
			{i > 0 && "· "}
			{g}
		</span>
	));

	const statsNode = (
		<div
			className="flex items-center gap-2"
			style={{
				fontFamily: fonts.body,
				fontSize: 10,
				color: colors.textDim,
				letterSpacing: "0.02em",
			}}
		>
			<span>{bpm} BPM</span>
			<span>·</span>
			<span>{energyLabel}</span>
			<span>·</span>
			<span>{valenceLabel}</span>
		</div>
	);

	const wrapperBorder: React.CSSProperties = showBorder
		? { borderColor: colors.border }
		: {};
	const wrapperClass = (extra = "") =>
		`${showBorder ? "pt-3 border-t" : ""} ${extra}`.trim();

	// ── dissolve ─────────────────────────────────────────────────
	if (style === "dissolve") {
		const statLabels = [`${bpm} BPM`, energyLabel, valenceLabel];
		return (
			<div
				className={wrapperClass()}
				style={wrapperBorder}
				onClick={toggle}
				onMouseEnter={() => setHovered(true)}
				onMouseLeave={() => setHovered(false)}
			>
				{active ? (
					<div
						key={animKey}
						style={{ animation: "hearted-fade 220ms ease-out forwards" }}
					>
						<p style={textureText}>{sonicTexture}</p>
						<span style={triggerPill(hovered)}>← back</span>
					</div>
				) : (
					<div
						key={animKey}
						className="cursor-pointer select-none"
						style={{
							animation:
								animKey > 0
									? "hearted-fade 220ms ease-out forwards"
									: undefined,
							background: hovered ? colors.surfaceHover : "transparent",
							borderRadius: 6,
							padding: "6px 8px",
							margin: "0 -8px",
							transition: "background 180ms ease",
						}}
					>
						<div className="flex items-center justify-between gap-3">
							<div className="flex items-center gap-1.5 flex-wrap">
								{genreNodes}
							</div>
							<div className="flex items-center gap-1.5 flex-shrink-0">
								{statLabels.map((label, i) => (
									<React.Fragment key={label}>
										{i > 0 && (
											<span
												style={{
													fontFamily: fonts.body,
													fontSize: 10,
													color: colors.border,
												}}
											>
												·
											</span>
										)}
										<span
											style={{
												fontFamily: fonts.body,
												fontSize: 10,
												letterSpacing: "0.02em",
												color: hovered ? colors.accent : colors.textDim,
												transition: `color 180ms ease ${i * 45}ms`,
											}}
										>
											{label}
										</span>
									</React.Fragment>
								))}
							</div>
						</div>
						<span style={triggerPill(hovered)}>sound →</span>
					</div>
				)}
			</div>
		);
	}

	// ── whisper ─────────────────────────────────────────────────
	if (style === "whisper") {
		return (
			<div className={wrapperClass("space-y-2")} style={wrapperBorder}>
				<div className="flex items-center justify-between gap-3">
					<div className="flex items-center gap-1.5 flex-wrap">
						{genreNodes}
					</div>
					{statsNode}
				</div>
				<div
					className="cursor-pointer select-none"
					onClick={toggle}
					onMouseEnter={() => setHovered(true)}
					onMouseLeave={() => setHovered(false)}
				>
					<div className="flex items-center justify-between gap-2">
						<span
							style={{
								fontFamily: fonts.body,
								fontSize: 11,
								fontStyle: "italic",
								color: hovered && !active ? colors.text : colors.accent,
								letterSpacing: "0.01em",
								transition: "color 200ms ease",
							}}
						>
							~ {whisperPhrase}
						</span>
						<span
							style={{
								color: colors.textDim,
								fontSize: 11,
								flexShrink: 0,
								display: "inline-block",
								transform: active ? "rotate(180deg)" : "rotate(0deg)",
								transition:
									"transform 280ms cubic-bezier(0.165, 0.84, 0.44, 1)",
							}}
						>
							▾
						</span>
					</div>
					<div
						style={{
							maxHeight: active ? 240 : 0,
							opacity: active ? 1 : 0,
							overflow: "hidden",
							marginTop: active ? 8 : 0,
							transition:
								"max-height 360ms cubic-bezier(0.165, 0.84, 0.44, 1), opacity 240ms ease, margin-top 360ms cubic-bezier(0.165, 0.84, 0.44, 1)",
						}}
					>
						<p style={textureText}>{sonicTexture}</p>
					</div>
				</div>
			</div>
		);
	}

	// ── blur ─────────────────────────────────────────────────────
	if (style === "blur") {
		return (
			<div className={wrapperClass()} style={wrapperBorder}>
				<div
					className="cursor-pointer select-none"
					onClick={toggle}
					onMouseEnter={() => setHovered(true)}
					onMouseLeave={() => setHovered(false)}
					style={{
						display: "grid",
						background: hovered ? colors.surfaceHover : "transparent",
						borderRadius: 6,
						padding: "6px 8px",
						margin: "0 -8px",
						transition: "background 180ms ease",
					}}
				>
					<div
						style={{
							gridColumn: 1,
							gridRow: 1,
							transition: "filter 280ms ease-in-out, opacity 280ms ease-in-out",
							filter: active ? "blur(6px)" : "blur(0px)",
							opacity: active ? 0 : 1,
							pointerEvents: active ? "none" : "auto",
						}}
					>
						<div className="flex items-center justify-between gap-3">
							<div className="flex items-center gap-1.5 flex-wrap">
								{genreNodes}
							</div>
							{statsNode}
						</div>
						<span style={triggerPill(hovered)}>sound texture →</span>
					</div>
					<div
						style={{
							gridColumn: 1,
							gridRow: 1,
							transition:
								"filter 250ms ease-out 80ms, opacity 250ms ease-out 80ms",
							filter: active ? "blur(0px)" : "blur(6px)",
							opacity: active ? 1 : 0,
							pointerEvents: active ? "auto" : "none",
						}}
					>
						<p style={textureText}>{sonicTexture}</p>
						<span style={triggerPill(hovered)}>← back</span>
					</div>
				</div>
			</div>
		);
	}

	// ── genre ────────────────────────────────────────────────────
	if (style === "genre") {
		return (
			<div className={wrapperClass("space-y-1.5")} style={wrapperBorder}>
				<div className="flex items-center justify-between gap-3">
					<div className="flex items-center gap-1.5 flex-wrap">
						{genres.map((g, i) => (
							<span
								key={g}
								style={{
									fontFamily: fonts.body,
									fontSize: 11,
									color: colors.textMuted,
									letterSpacing: "0.02em",
									opacity: active ? (i === 0 ? 0.35 : 0.15) : i === 0 ? 1 : 0.4,
									transition: `opacity 200ms ease ${i * 40}ms`,
								}}
							>
								{i > 0 && "· "}
								{g}
							</span>
						))}
						<button
							type="button"
							onClick={toggle}
							onMouseEnter={() => setHovered(true)}
							onMouseLeave={() => setHovered(false)}
							style={{
								fontFamily: fonts.body,
								fontSize: 10,
								color: hovered ? colors.text : colors.accent,
								background: "transparent",
								border: `1px solid ${colors.accentMuted}`,
								borderRadius: 20,
								padding: "1px 8px",
								cursor: "pointer",
								letterSpacing: "0.04em",
								transition: "color 180ms ease",
								lineHeight: 1.6,
							}}
						>
							~ sound
						</button>
					</div>
					{statsNode}
				</div>
				<div
					style={{
						maxHeight: active ? 240 : 0,
						opacity: active ? 1 : 0,
						overflow: "hidden",
						marginTop: active ? 10 : 0,
						transition:
							"max-height 320ms cubic-bezier(0.165, 0.84, 0.44, 1), opacity 220ms ease, margin-top 320ms cubic-bezier(0.165, 0.84, 0.44, 1)",
					}}
				>
					<p style={textureText}>{sonicTexture}</p>
					<button
						type="button"
						onClick={toggle}
						onMouseEnter={() => setHovered(true)}
						onMouseLeave={() => setHovered(false)}
						style={{
							...triggerPill(hovered),
							background: "none",
							border: "none",
							padding: 0,
							cursor: "pointer",
							marginTop: 6,
						}}
					>
						← back
					</button>
				</div>
			</div>
		);
	}

	// ── push: badge morphs K-POP ↔ audio texture, right side swaps stats ↔ description ──
	const pushAnim =
		animKey === 0
			? undefined
			: active
				? "hearted-push-up 240ms cubic-bezier(0.165, 0.84, 0.44, 1) forwards"
				: "hearted-push-down 240ms cubic-bezier(0.165, 0.84, 0.44, 1) forwards";

	return (
		<div className={wrapperClass()} style={wrapperBorder}>
			<div style={{ display: "flex", alignItems: "stretch", gap: 10 }}>
				{/* Badge — stretches to match right column height */}
				<div
					className="cursor-pointer select-none"
					onClick={toggle}
					onMouseEnter={() => setHoveredGenre(true)}
					onMouseLeave={() => setHoveredGenre(false)}
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						flexShrink: 0,
					}}
				>
					<span
						style={{
							fontFamily: fonts.body,
							fontSize: 9,
							fontWeight: 500,
							letterSpacing: "0.09em",
							textTransform: "uppercase",
							background: active ? colors.accent : "transparent",
							color: active ? colors.bg : colors.accent,
							border: `0.5px solid ${colors.accent}`,
							borderRadius: 0,
							padding: "0 6px",
							display: "flex",
							alignItems: "center",
							alignSelf: "stretch",
							transition: "background 220ms ease, color 220ms ease",
							opacity: hoveredGenre ? 0.8 : 1,
						}}
					>
						{active ? "audio texture" : primaryGenre}
					</span>
					{!active && (
						<span style={{ display: "inline-flex", gap: 6 }}>
							{restGenres.map((g, i) => (
								<span
									key={g}
									style={{
										fontFamily: fonts.body,
										fontSize: 10,
										color: colors.accent,
										opacity: hoveredGenre ? 0.7 : 0,
										transform: hoveredGenre
											? "translateX(0)"
											: "translateX(6px)",
										transition: `opacity 180ms ease ${i * 50}ms, transform 200ms cubic-bezier(0.165, 0.84, 0.44, 1) ${i * 50}ms`,
									}}
								>
									{g}
								</span>
							))}
						</span>
					)}
				</div>

				{/* Right: push-animated — stats OR texture description */}
				<div style={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
					<div key={animKey} style={{ animation: pushAnim }}>
						{active ? (
							<p style={textureText}>{sonicTexture}</p>
						) : (
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: 3,
									alignItems: "flex-end",
								}}
							>
								<div
									className="flex items-center gap-3 justify-end"
									style={{
										fontFamily: fonts.body,
										fontSize: 9,
										fontWeight: 400,
										letterSpacing: "0.1em",
										textTransform: "uppercase",
										color: colors.accent,
										opacity: 0.8,
									}}
								>
									{[`${bpm} BPM`, energyLabel, valenceLabel].map((label) => (
										<span key={label}>{label}</span>
									))}
								</div>
								<p
									style={{
										fontFamily: fonts.body,
										fontSize: 10,
										color: colors.textDim,
										letterSpacing: "0.02em",
										margin: 0,
										textAlign: "right",
										visibility: themesAboveStats ? "visible" : "hidden",
										whiteSpace: "nowrap",
										overflow: "hidden",
										textOverflow: "ellipsis",
									}}
								>
									{themesAboveStats?.join(" · ") ?? "placeholder"}
								</p>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
