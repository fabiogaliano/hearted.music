import { useState } from "react";
import { fonts } from "@/lib/theme/fonts";
import type { ColorProps } from "./types";

interface HorizontalJourneyProps {
	journey: Array<{ section: string; mood: string; description: string }>;
	colors: ColorProps;
}

export function HorizontalJourney({ journey, colors }: HorizontalJourneyProps) {
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
		<div className="space-y-3">
			{/* Header row: label + wave ticks */}
			<div className="flex items-end justify-between">
				<span
					style={{
						fontFamily: fonts.body,
						fontSize: 9,
						fontWeight: 500,
						letterSpacing: "0.1em",
						textTransform: "uppercase",
						color: colors.accent,
					}}
				>
					{segment.section}
				</span>
				<div className="flex items-end gap-1.5">
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
									background: dist <= 1 ? colors.accent : colors.textDim,
									border: "none",
									padding: 0,
									cursor: isActive ? "default" : "pointer",
									opacity,
									transform: isActive ? undefined : `scaleY(${scale})`,
									transformOrigin: "bottom",
									transition:
										"transform 220ms ease-out, background 220ms ease, opacity 220ms ease",
									animation: isActive
										? "hearted-tick-pulse 1s ease-in-out infinite alternate"
										: undefined,
								}}
							/>
						);
					})}
				</div>
			</div>

			{/* Content card */}
			<div
				className="rounded-lg px-4 py-3"
				style={{ background: colors.surface, minHeight: 96 }}
			>
				<div
					key={animKey}
					style={{ animation: `${animName} 200ms ease forwards` }}
				>
					<p
						style={{
							fontFamily: fonts.body,
							fontSize: 13,
							lineHeight: 1.6,
							color: colors.textMuted,
						}}
					>
						{segment.description}
					</p>
				</div>
			</div>

			{/* Arrows only */}
			<div className="flex items-center justify-end gap-1">
				<button
					type="button"
					onClick={() => go(-1)}
					disabled={!canPrev}
					style={{
						width: 26,
						height: 26,
						borderRadius: 4,
						background: "transparent",
						border: `1px solid ${colors.border}`,
						color: canPrev ? colors.textMuted : colors.textDim,
						opacity: canPrev ? 1 : 0.35,
						cursor: canPrev ? "pointer" : "default",
						fontSize: 13,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						transition: "opacity 200ms, color 200ms",
					}}
				>
					←
				</button>
				<button
					type="button"
					onClick={() => go(1)}
					disabled={!canNext}
					style={{
						width: 26,
						height: 26,
						borderRadius: 4,
						background: "transparent",
						border: `1px solid ${colors.border}`,
						color: canNext ? colors.textMuted : colors.textDim,
						opacity: canNext ? 1 : 0.35,
						cursor: canNext ? "pointer" : "default",
						fontSize: 13,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						transition: "opacity 200ms, color 200ms",
					}}
				>
					→
				</button>
			</div>
		</div>
	);
}
