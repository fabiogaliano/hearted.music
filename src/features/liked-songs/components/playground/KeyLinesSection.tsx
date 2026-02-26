import { useState, useRef, useCallback } from "react";
import { fonts } from "@/lib/theme/fonts";
import type { ColorProps } from "./types";

interface KeyLinesSectionProps {
	keyLines: Array<{ line: string; insight: string }>;
	colors: ColorProps;
}

export function KeyLinesSection({ keyLines, colors }: KeyLinesSectionProps) {
	if (!keyLines.length) return null;

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
		<div className="space-y-4">
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
				Key Lines
			</h3>
			<div className="space-y-3" onMouseLeave={handleListLeave}>
				{keyLines.map((kl, i) => {
					const isOpen = openIndex === i;
					return (
						<div
							key={i}
							style={{
								borderLeft: `2px solid ${isOpen ? colors.accent : colors.accentMuted}`,
								paddingLeft: 12,
								cursor: "pointer",
								transition: "border-color 200ms ease",
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
										fontFamily: fonts.body,
										fontStyle: "italic",
										fontSize: 14,
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
									marginTop: isOpen ? 4 : 0,
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
