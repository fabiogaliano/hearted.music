import {
	ArrowLeftIcon,
	ArrowRightIcon,
	CaretDownIcon,
} from "@phosphor-icons/react";
import { useCallback, useRef, useState } from "react";
import type { AnalysisContent } from "@/features/liked-songs/types";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";

/** Prod-style "headline → click → interpretation" toggle. */
export function HeadlineToggle({
	headline,
	interpretation,
	theme,
	size = 24,
}: {
	headline: string;
	interpretation?: string;
	theme: ThemeConfig;
	size?: number;
}) {
	const [open, setOpen] = useState(false);
	const [hovered, setHovered] = useState(false);

	if (!interpretation) {
		return (
			<p
				style={{
					fontFamily: fonts.display,
					fontSize: size,
					fontWeight: 400,
					lineHeight: 1.35,
					color: theme.text,
					margin: 0,
				}}
			>
				{headline}
			</p>
		);
	}

	return (
		<button
			type="button"
			onClick={() => setOpen((v) => !v)}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			aria-expanded={open}
			style={{
				background: "transparent",
				border: "none",
				padding: 0,
				textAlign: "left",
				cursor: "pointer",
				width: "100%",
				position: "relative",
			}}
		>
			<div style={{ animation: "hearted-fade 250ms ease forwards" }}>
				{open ? (
					<p
						style={{
							fontFamily: fonts.body,
							fontSize: 16,
							lineHeight: 1.55,
							color: theme.textMuted,
							borderLeft: `2px solid ${theme.primary}`,
							paddingLeft: 12,
							fontStyle: "italic",
							margin: 0,
						}}
					>
						{interpretation}
					</p>
				) : (
					<p
						style={{
							fontFamily: fonts.display,
							fontSize: size,
							fontWeight: 400,
							lineHeight: 1.35,
							color: hovered ? theme.primary : theme.text,
							transition: "color 200ms ease",
							margin: 0,
						}}
					>
						{headline}
					</p>
				)}
			</div>
			<span
				style={{
					fontFamily: fonts.body,
					fontSize: 11,
					letterSpacing: "0.04em",
					color: theme.textMuted,
					opacity: hovered ? 1 : 0,
					position: "absolute",
					top: "100%",
					right: 0,
					marginTop: 8,
					pointerEvents: "none",
					transition: "opacity 200ms ease",
				}}
			>
				{open ? "← back" : "read deeper →"}
			</span>
		</button>
	);
}

/** Prod-style themes line: inline ·-separated names, hover tooltip for descriptions. */
export function ThemesInline({
	themes,
	theme,
	color,
}: {
	themes: NonNullable<AnalysisContent["themes"]>;
	theme: ThemeConfig;
	color?: string;
}) {
	return (
		<p
			style={{
				fontFamily: fonts.body,
				fontSize: 12,
				letterSpacing: "0.04em",
				color: color ?? theme.textMuted,
				margin: 0,
				lineHeight: 1.55,
			}}
		>
			{themes.map((t, i) => (
				<span key={`${t.name}-${i}`} title={t.description}>
					{t.name}
					{i < themes.length - 1 && (
						<span style={{ opacity: 0.55, margin: "0 7px" }}>·</span>
					)}
				</span>
			))}
		</p>
	);
}

/** Prod-style KeyLines: italic 15px quoted lines, hover preview + click pin reveals insight. */
export function KeyLinesDisplay({
	keyLines,
	theme,
	showHeader = true,
}: {
	keyLines: NonNullable<AnalysisContent["key_lines"]>;
	theme: ThemeConfig;
	showHeader?: boolean;
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

	if (!keyLines.length) return null;

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
			{showHeader && (
				<h3
					style={{
						fontFamily: fonts.body,
						fontSize: 10,
						fontWeight: 500,
						letterSpacing: "0.08em",
						textTransform: "uppercase",
						color: theme.textMuted,
						margin: 0,
					}}
				>
					Key lines
				</h3>
			)}
			<div
				style={{ display: "flex", flexDirection: "column", gap: 16 }}
				onMouseLeave={handleListLeave}
			>
				{keyLines.map((kl, i) => {
					const isOpen = openIndex === i;
					const isLast = i === keyLines.length - 1;
					return (
						<div
							key={i}
							style={{
								paddingBottom: isLast ? 0 : 16,
								borderBottom: isLast ? "none" : `1px solid ${theme.border}`,
								cursor: "pointer",
							}}
							role="button"
							tabIndex={0}
							onMouseEnter={() => handleHover(i)}
							onClick={() => handleClick(i)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									handleClick(i);
								}
							}}
						>
							<div
								style={{
									display: "flex",
									alignItems: "baseline",
									justifyContent: "space-between",
									gap: 8,
								}}
							>
								<p
									style={{
										fontFamily: fonts.display,
										fontStyle: "italic",
										fontSize: 15,
										lineHeight: 1.5,
										color: isOpen ? theme.text : theme.textMuted,
										transition: "color 200ms ease",
										margin: 0,
									}}
								>
									&ldquo;{kl.line}&rdquo;
								</p>
								<span
									style={{
										fontFamily: fonts.body,
										fontSize: 10,
										color: theme.primary,
										opacity: isOpen ? 0 : 0.5,
										flexShrink: 0,
										transition: "opacity 180ms ease",
									}}
								>
									<CaretDownIcon size={12} />
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
										color: theme.textMuted,
										margin: 0,
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

/** Prod-style HorizontalJourney: one section at a time, wave-tick nav, arrows. */
export function JourneyDisplay({
	journey,
	theme,
	showHeader = false,
}: {
	journey: NonNullable<AnalysisContent["journey"]>;
	theme: ThemeConfig;
	showHeader?: boolean;
}) {
	const [index, setIndex] = useState(0);
	const [dir, setDir] = useState<"forward" | "back">("forward");
	const [animKey, setAnimKey] = useState(0);

	if (!journey.length) return null;

	const segment = journey[index];
	const canPrev = index > 0;
	const canNext = index < journey.length - 1;
	const animName =
		dir === "forward" ? "hearted-slide-fwd" : "hearted-slide-back";

	const go = (direction: 1 | -1) => {
		const next = index + direction;
		if (next < 0 || next >= journey.length) return;
		setDir(direction === 1 ? "forward" : "back");
		setIndex(next);
		setAnimKey((k) => k + 1);
	};

	const jumpTo = (i: number) => {
		if (i === index) return;
		setDir(i > index ? "forward" : "back");
		setIndex(i);
		setAnimKey((k) => k + 1);
	};

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
			{showHeader && (
				<h3
					style={{
						fontFamily: fonts.body,
						fontSize: 10,
						fontWeight: 500,
						letterSpacing: "0.08em",
						textTransform: "uppercase",
						color: theme.textMuted,
						margin: 0,
					}}
				>
					How it moves
				</h3>
			)}
			<div
				style={{
					display: "flex",
					alignItems: "flex-end",
					justifyContent: "space-between",
				}}
			>
				<span
					style={{
						fontFamily: fonts.body,
						fontSize: 9,
						fontWeight: 500,
						letterSpacing: "0.1em",
						textTransform: "uppercase",
						color: theme.primary,
					}}
				>
					{segment.section}
				</span>
				<div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
					{journey.map((_, i) => {
						const dist = Math.abs(i - index);
						const isActive = dist === 0;
						const scale = isActive
							? 1
							: dist === 1
								? 0.62
								: dist === 2
									? 0.44
									: 0.34;
						const opacity = isActive ? 1 : dist === 1 ? 0.5 : 0.22;
						return (
							<button
								key={i}
								type="button"
								aria-label={`Step ${i + 1}`}
								onClick={() => jumpTo(i)}
								style={{
									width: 1.5,
									height: 14,
									borderRadius: 0,
									background: dist <= 1 ? theme.primary : theme.textMuted,
									border: "none",
									padding: 0,
									cursor: isActive ? "default" : "pointer",
									opacity,
									transform: isActive ? undefined : `scaleY(${scale})`,
									transformOrigin: "bottom",
									transition:
										"transform 220ms ease-out, background 220ms ease, opacity 220ms ease",
								}}
							/>
						);
					})}
				</div>
			</div>
			<div style={{ background: theme.surface, borderRadius: 8, padding: 16 }}>
				<div
					key={animKey}
					style={{ animation: `${animName} 200ms ease forwards` }}
				>
					<div
						style={{
							fontFamily: fonts.display,
							fontStyle: "italic",
							fontSize: 13,
							color: theme.text,
							marginBottom: 8,
						}}
					>
						{segment.mood}
					</div>
					<p
						style={{
							fontFamily: fonts.body,
							fontSize: 14,
							lineHeight: 1.6,
							color: theme.textMuted,
							margin: 0,
						}}
					>
						{segment.description}
					</p>
				</div>
			</div>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "flex-end",
					gap: 8,
				}}
			>
				<button
					type="button"
					onClick={() => go(-1)}
					disabled={!canPrev}
					aria-label="Previous section"
					style={{
						width: 32,
						height: 32,
						borderRadius: 4,
						background: "transparent",
						border: `1px solid ${theme.border}`,
						color: canPrev ? theme.textMuted : theme.border,
						opacity: canPrev ? 1 : 0.35,
						cursor: canPrev ? "pointer" : "default",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						transition: "opacity 200ms, color 200ms",
					}}
				>
					<ArrowLeftIcon size={13} />
				</button>
				<button
					type="button"
					onClick={() => go(1)}
					disabled={!canNext}
					aria-label="Next section"
					style={{
						width: 32,
						height: 32,
						borderRadius: 4,
						background: "transparent",
						border: `1px solid ${theme.border}`,
						color: canNext ? theme.textMuted : theme.border,
						opacity: canNext ? 1 : 0.35,
						cursor: canNext ? "pointer" : "default",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						transition: "opacity 200ms, color 200ms",
					}}
				>
					<ArrowRightIcon size={13} />
				</button>
			</div>
		</div>
	);
}

/** Prod-style mood block: compound mood as eyebrow + italic description. */
export function MoodBlock({
	compoundMood,
	moodDescription,
	theme,
	stacked = false,
}: {
	compoundMood?: string;
	moodDescription?: string;
	theme: ThemeConfig;
	stacked?: boolean;
}) {
	if (!compoundMood && !moodDescription) return null;
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
			{compoundMood && (
				<span
					style={{
						fontFamily: fonts.body,
						fontWeight: 500,
						fontSize: 11,
						letterSpacing: "0.12em",
						textTransform: "uppercase",
						color: theme.primary,
						display: "block",
					}}
				>
					{compoundMood}
				</span>
			)}
			{moodDescription && (
				<p
					style={{
						fontFamily: fonts.body,
						fontStyle: "italic",
						fontSize: stacked ? 15 : 14,
						lineHeight: 1.55,
						color: theme.textMuted,
						margin: 0,
					}}
				>
					{moodDescription}
				</p>
			)}
		</div>
	);
}

/** Prod-style genre pills, rendered below the hero (where prod puts them). */
export function GenreRow({
	genres,
	theme,
}: {
	genres: string[];
	theme: ThemeConfig;
}) {
	const slice = genres.slice(0, 3);
	const [primary, ...alts] = slice;
	if (!primary) return null;
	return (
		<div style={{ display: "flex", flexWrap: "wrap", gap: "4px 6px" }}>
			<span
				style={{
					fontFamily: fonts.body,
					fontSize: 11,
					letterSpacing: "0.07em",
					padding: "2px 10px",
					border: `0.5px solid ${theme.primary}`,
					borderRadius: 24,
					color: theme.primary,
				}}
			>
				{primary}
			</span>
			{alts.map((g) => (
				<span
					key={g}
					style={{
						fontFamily: fonts.body,
						fontSize: 11,
						letterSpacing: "0.06em",
						padding: "2px 10px",
						border: `0.5px solid ${theme.border}`,
						borderRadius: 24,
						color: theme.textMuted,
					}}
				>
					{g}
				</span>
			))}
		</div>
	);
}
