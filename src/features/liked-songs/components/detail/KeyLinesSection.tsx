import { CaretDown } from "@phosphor-icons/react";
import { useCallback, useRef, useState } from "react";
import { fonts } from "@/lib/theme/fonts";
import type { ColorProps } from "./types";

interface KeyLinesSectionProps {
	keyLines: Array<{ line: string; insight: string }>;
	colors: ColorProps;
}

export function KeyLinesSection({ keyLines, colors }: KeyLinesSectionProps) {
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

	const handleLeave = useCallback(() => {
		if (pinnedIndex === -1) {
			closeTimeoutRef.current = setTimeout(() => {
				setOpenIndex(-1);
			}, 150);
		}
	}, [pinnedIndex]);

	if (!keyLines.length) return null;

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
			<div className="space-y-4">
				{keyLines.map((kl, i) => {
					const isOpen = openIndex === i;
					return (
						<button
							key={`${kl.line}-${kl.insight}`}
							type="button"
							style={{
								width: "100%",
								padding: 0,
								paddingBottom: i < keyLines.length - 1 ? 16 : 0,
								border: "none",
								borderBottom:
									i < keyLines.length - 1
										? `1px solid ${colors.border}`
										: "none",
								background: "transparent",
								cursor: "pointer",
								textAlign: "left",
								display: "block",
							}}
							onMouseEnter={() => handleHover(i)}
							onMouseLeave={handleLeave}
							onClick={() => handleClick(i)}
							aria-expanded={isOpen}
						>
							<span
								style={{
									display: "flex",
									alignItems: "baseline",
									justifyContent: "space-between",
								}}
							>
								<span
									style={{
										fontFamily: fonts.display,
										fontStyle: "italic",
										fontSize: 15,
										lineHeight: 1.5,
										color: isOpen ? colors.text : colors.textMuted,
										transition: "color 200ms ease",
										display: "block",
									}}
								>
									"{kl.line}"
								</span>
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
									<CaretDown size={12} />
								</span>
							</span>
							<span
								style={{
									maxHeight: isOpen ? 120 : 0,
									opacity: isOpen ? 1 : 0,
									overflow: "hidden",
									marginTop: isOpen ? 6 : 0,
									paddingLeft: 8,
									transition:
										"max-height 220ms ease, opacity 180ms ease, margin-top 220ms ease",
									display: "block",
								}}
							>
								<span
									style={{
										fontFamily: fonts.body,
										fontSize: 12,
										lineHeight: 1.5,
										color: colors.textMuted,
										display: "block",
									}}
								>
									{kl.insight}
								</span>
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
