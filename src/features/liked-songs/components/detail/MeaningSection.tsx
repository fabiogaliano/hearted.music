/**
 * MeaningSection: "The Hook", "What It's About", and "The Journey"
 * Internal sub-components: EmotionalHook, ThemeItem, JourneyTimeline
 */
import { useCallback, useRef, useState } from "react";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import type { AnalysisContent } from "../../types";
import { getIntensityLabel } from "./utils";

type Theme = {
	name: string;
	confidence: number;
	description: string;
};
type Emotional = NonNullable<AnalysisContent["emotional"]>;
type JourneySegment = {
	mood: string;
	section: string;
	description: string;
};

function EmotionalHook({
	theme,
	emotional,
}: {
	theme: ThemeConfig;
	emotional: Emotional;
}) {
	return (
		<section className="border-y py-8" style={{ borderColor: theme.border }}>
			{emotional.mood_description && (
				<p
					className="text-lg leading-relaxed"
					style={{
						fontFamily: fonts.display,
						color: theme.text,
						fontStyle: "italic",
					}}
				>
					{emotional.mood_description}
				</p>
			)}

			<div className="mt-5 flex flex-wrap items-center gap-3">
				{emotional.dominant_mood && (
					<span
						className="text-xs tracking-wide"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						{emotional.dominant_mood}
					</span>
				)}
				{emotional.intensity !== undefined && (
					<>
						<span style={{ color: theme.border }}>·</span>
						<span
							className="text-xs tracking-wide"
							style={{ fontFamily: fonts.body, color: theme.textMuted }}
						>
							{getIntensityLabel(emotional.intensity)}
						</span>
					</>
				)}
			</div>
		</section>
	);
}

function ThemeItem({
	theme,
	themeItem,
	isOpen,
	onHover,
	onClick,
}: {
	theme: ThemeConfig;
	themeItem: Theme;
	isOpen: boolean;
	onHover: () => void;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className="group w-full cursor-pointer border-none bg-transparent p-0 text-left"
			onMouseEnter={onHover}
			onClick={onClick}
		>
			<p
				className="text-sm font-medium"
				style={{ fontFamily: fonts.body, color: theme.text }}
			>
				{themeItem.name}
				{themeItem.description && (
					<span
						className="ml-2 text-xs transition-opacity"
						style={{ color: theme.textMuted, opacity: isOpen ? 0 : 0.5 }}
					>
						↓
					</span>
				)}
			</p>
			{themeItem.description && (
				<div
					className="overflow-hidden transition-all duration-200"
					style={{
						maxHeight: isOpen ? "100px" : "0px",
						opacity: isOpen ? 1 : 0,
						marginTop: isOpen ? "6px" : "0px",
					}}
				>
					<p
						className="text-xs leading-relaxed"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						{themeItem.description}
					</p>
				</div>
			)}
		</button>
	);
}

function ThemesList({
	theme,
	themes,
}: {
	theme: ThemeConfig;
	themes: Theme[];
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
			if (pinnedIndex === -1) {
				setOpenIndex(index);
			}
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
			closeTimeoutRef.current = setTimeout(() => {
				setOpenIndex(-1);
			}, 150);
		}
	}, [pinnedIndex]);

	return (
		<section>
			<h4
				className="mb-5 text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				What It's About
			</h4>

			{/* biome-ignore lint/a11y/noStaticElementInteractions: onMouseLeave tracks hover exit for preview closing, not interactive behavior */}
			<div className="space-y-3" onMouseLeave={handleListLeave}>
				{themes.map((themeItem, index) => (
					<ThemeItem
						key={themeItem.name}
						theme={theme}
						themeItem={themeItem}
						isOpen={openIndex === index}
						onHover={() => handleHover(index)}
						onClick={() => handleClick(index)}
					/>
				))}
			</div>
		</section>
	);
}

function JourneyTimeline({
	theme,
	journey,
}: {
	theme: ThemeConfig;
	journey: JourneySegment[];
}) {
	return (
		<div className="mt-5 space-y-4">
			{journey.map((segment) => (
				<div key={`${segment.section}-${segment.mood}`} className="flex gap-5">
					<div
						className="w-16 flex-shrink-0 pt-0.5 text-[10px] tracking-widest uppercase"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						{segment.section}
					</div>
					<div className="flex-1">
						<p
							className="text-sm font-medium"
							style={{ fontFamily: fonts.body, color: theme.text }}
						>
							{segment.mood}
						</p>
						{segment.description && (
							<p
								className="mt-1 text-xs leading-relaxed"
								style={{ fontFamily: fonts.body, color: theme.textMuted }}
							>
								{segment.description}
							</p>
						)}
					</div>
				</div>
			))}
		</div>
	);
}

interface MeaningSectionProps {
	theme: ThemeConfig;
	emotional?: Emotional;
	themes?: Theme[];
	journey?: JourneySegment[];
	isJourneyExpanded: boolean;
	onToggleJourney: () => void;
}

export function MeaningSection({
	theme,
	emotional,
	themes,
	journey,
	isJourneyExpanded,
	onToggleJourney,
}: MeaningSectionProps) {
	const hasContent =
		emotional ||
		(themes && themes.length > 0) ||
		(journey && journey.length > 0);
	if (!hasContent) return null;

	return (
		<>
			{emotional && <EmotionalHook theme={theme} emotional={emotional} />}

			{themes && themes.length > 0 && (
				<ThemesList theme={theme} themes={themes} />
			)}

			{journey && journey.length > 0 && (
				<section>
					<button
						type="button"
						onClick={onToggleJourney}
						className="group flex w-full items-center justify-between"
					>
						<h4
							className="text-xs tracking-widest uppercase"
							style={{ fontFamily: fonts.body, color: theme.textMuted }}
						>
							The Journey
						</h4>
						<span
							className="text-xs opacity-40 transition-opacity group-hover:opacity-70"
							style={{ color: theme.textMuted }}
						>
							{isJourneyExpanded ? "−" : `${journey.length} sections`}
						</span>
					</button>

					{isJourneyExpanded && (
						<JourneyTimeline theme={theme} journey={journey} />
					)}
				</section>
			)}
		</>
	);
}
