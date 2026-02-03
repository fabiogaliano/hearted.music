/**
 * MeaningSection: "The Hook", "What It's About", and "The Journey"
 * Internal sub-components: EmotionalHook, ThemeItem, JourneyTimeline
 */
import { useCallback, useRef, useState } from "react";

import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import type { AnalysisContent } from "../../types";
import { getIntensityLabel } from "./utils";

// Type aliases for nested types
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

// ─────────────────────────────────────────────────────────────────────────
// Internal: The Hook - Emotional truth
// ─────────────────────────────────────────────────────────────────────────

function EmotionalHook({ emotional }: { emotional: Emotional }) {
	const theme = useTheme();
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

			{/* Quick tags */}
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

// ─────────────────────────────────────────────────────────────────────────
// Internal: Theme item (controlled - parent manages which is open)
// ─────────────────────────────────────────────────────────────────────────

function ThemeItem({
	themeItem,
	isOpen,
	onHover,
	onClick,
}: {
	themeItem: Theme;
	isOpen: boolean;
	onHover: () => void;
	onClick: () => void;
}) {
	const theme = useTheme();
	return (
		<div
			className="group cursor-pointer"
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
		</div>
	);
}

// ─────────────────────────────────────────────────────────────────────────
// Internal: Themes list with coordinated hover (only one open at a time)
// ─────────────────────────────────────────────────────────────────────────

function ThemesList({ themes }: { themes: Theme[] }) {
	const theme = useTheme();
	// Track which theme is open (-1 = none)
	const [openIndex, setOpenIndex] = useState<number>(-1);
	// Track if user clicked to "pin" open (won't close on mouse leave)
	const [pinnedIndex, setPinnedIndex] = useState<number>(-1);
	const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const handleHover = useCallback(
		(index: number) => {
			// Clear any pending close
			if (closeTimeoutRef.current) {
				clearTimeout(closeTimeoutRef.current);
				closeTimeoutRef.current = null;
			}
			// If nothing is pinned, open on hover
			if (pinnedIndex === -1) {
				setOpenIndex(index);
			}
		},
		[pinnedIndex],
	);

	const handleClick = useCallback(
		(index: number) => {
			if (pinnedIndex === index) {
				// Unpin and close
				setPinnedIndex(-1);
				setOpenIndex(-1);
			} else {
				// Pin this one open
				setPinnedIndex(index);
				setOpenIndex(index);
			}
		},
		[pinnedIndex],
	);

	const handleListLeave = useCallback(() => {
		// When leaving the entire list, close after delay (unless pinned)
		if (pinnedIndex === -1) {
			closeTimeoutRef.current = setTimeout(() => {
				setOpenIndex(-1);
			}, 150);
		}
	}, [pinnedIndex]);

	return (
		<section onMouseLeave={handleListLeave}>
			<h4
				className="mb-5 text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				What It's About
			</h4>

			<div className="space-y-3">
				{themes.map((themeItem, index) => (
					<ThemeItem
						key={index}
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

// ─────────────────────────────────────────────────────────────────────────
// Internal: Collapsible journey timeline
// ─────────────────────────────────────────────────────────────────────────

function JourneyTimeline({ journey }: { journey: JourneySegment[] }) {
	const theme = useTheme();
	return (
		<div className="animate-in fade-in slide-in-from-top-2 mt-5 space-y-4 duration-300">
			{journey.map((segment, index) => (
				<div key={index} className="flex gap-5">
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

// ─────────────────────────────────────────────────────────────────────────
// Main Section Component
// ─────────────────────────────────────────────────────────────────────────

interface MeaningSectionProps {
	emotional?: Emotional;
	themes?: Theme[];
	journey?: JourneySegment[];
	isJourneyExpanded: boolean;
	onToggleJourney: () => void;
}

export function MeaningSection({
	emotional,
	themes,
	journey,
	isJourneyExpanded,
	onToggleJourney,
}: MeaningSectionProps) {
	const theme = useTheme();
	const hasContent =
		emotional ||
		(themes && themes.length > 0) ||
		(journey && journey.length > 0);
	if (!hasContent) return null;

	return (
		<>
			{/* THE HOOK - Emotional truth */}
			{emotional && <EmotionalHook emotional={emotional} />}

			{/* WHAT IT'S ABOUT - Theme names visible, descriptions on hover */}
			{themes && themes.length > 0 && <ThemesList themes={themes} />}

			{/* THE JOURNEY - Collapsed by default */}
			{journey && journey.length > 0 && (
				<section>
					<button
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

					{isJourneyExpanded && <JourneyTimeline journey={journey} />}
				</section>
			)}
		</>
	);
}
