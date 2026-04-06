/**
 * Song showcase step — displays analysis of a pre-seeded demo song.
 * Demonstrates the product's core value before pricing.
 * Demo song is outside monetization: no unlock rows, no credits.
 */

import { useEffect, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import {
	getDemoSongShowcase,
	type DemoSongData,
} from "@/lib/server/onboarding.functions";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import type { AnalysisContent } from "@/features/liked-songs/types";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";

type LoadState =
	| { status: "loading" }
	| { status: "loaded"; data: DemoSongData }
	| { status: "unavailable" };

export function SongShowcaseStep() {
	const theme = useTheme();
	const { goToStep } = useOnboardingNavigation();
	const [isNavigating, setIsNavigating] = useState(false);
	const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

	useEffect(() => {
		let cancelled = false;
		getDemoSongShowcase()
			.then((data) => {
				if (cancelled) return;
				setLoadState(
					data ? { status: "loaded", data } : { status: "unavailable" },
				);
			})
			.catch(() => {
				if (!cancelled) setLoadState({ status: "unavailable" });
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const handleContinue = async () => {
		if (isNavigating) return;
		setIsNavigating(true);
		try {
			await goToStep("match-showcase");
		} catch {
			setIsNavigating(false);
		}
	};

	useShortcut({
		key: "enter",
		handler: handleContinue,
		description: "Continue",
		scope: "onboarding-song-showcase",
		enabled: !isNavigating,
	});

	if (loadState.status === "loading") {
		return (
			<div className="text-center">
				<p
					className="text-lg font-light animate-pulse"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Loading demo...
				</p>
			</div>
		);
	}

	if (loadState.status === "unavailable") {
		return (
			<div className="text-center">
				<p
					className="text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Song Showcase
				</p>
				<h2
					className="mt-4 text-4xl leading-tight font-extralight"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					This is what hearted. does.
				</h2>
				<p
					className="mt-6 text-lg font-light"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Every song you've liked — understood deeply.
				</p>
				<ContinueButton
					theme={theme}
					isNavigating={isNavigating}
					onClick={handleContinue}
				/>
			</div>
		);
	}

	const { song, analysis: rawAnalysis } = loadState.data;
	const analysis = rawAnalysis as AnalysisContent;

	return (
		<div className="text-center">
			<p
				className="text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				Here's what we see
			</p>

			{/* Song identity */}
			<div className="mt-6 flex flex-col items-center gap-4">
				{song.imageUrl && (
					<img
						src={song.imageUrl}
						alt={`${song.name} album art`}
						className="h-24 w-24 rounded-lg object-cover shadow-md"
					/>
				)}
				<div>
					<h2
						className="text-2xl font-light"
						style={{ fontFamily: fonts.display, color: theme.text }}
					>
						{song.name}
					</h2>
					<p
						className="mt-1 text-sm"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						{song.artists.join(", ")}
					</p>
				</div>
			</div>

			{/* Analysis headline */}
			{analysis.headline && (
				<p
					className="mx-auto mt-8 max-w-md text-xl font-light leading-relaxed"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					{analysis.headline}
				</p>
			)}

			{/* Themes */}
			{analysis.themes && analysis.themes.length > 0 && (
				<div className="mt-6 flex flex-wrap justify-center gap-2">
					{analysis.themes.map((t) => (
						<span
							key={t.name}
							className="rounded-full px-3 py-1 text-xs tracking-wide"
							style={{
								fontFamily: fonts.body,
								color: theme.text,
								border: `1px solid ${theme.border}`,
							}}
						>
							{t.name}
						</span>
					))}
				</div>
			)}

			{/* Interpretation */}
			{analysis.interpretation && (
				<p
					className="mx-auto mt-6 max-w-md text-sm font-light leading-relaxed italic"
					style={{
						fontFamily: fonts.body,
						color: theme.textMuted,
						borderLeft: `2px solid ${theme.primary}`,
						paddingLeft: 12,
						textAlign: "left",
					}}
				>
					{analysis.interpretation}
				</p>
			)}

			{/* Key lines preview */}
			{analysis.key_lines && analysis.key_lines.length > 0 && (
				<div className="mx-auto mt-8 max-w-md space-y-3 text-left">
					{analysis.key_lines.slice(0, 2).map((kl) => (
						<div key={kl.line}>
							<p
								className="text-sm italic"
								style={{ fontFamily: fonts.display, color: theme.text }}
							>
								"{kl.line}"
							</p>
							<p
								className="mt-0.5 text-xs"
								style={{ fontFamily: fonts.body, color: theme.textMuted }}
							>
								{kl.insight}
							</p>
						</div>
					))}
				</div>
			)}

			{/* Mood */}
			{analysis.compound_mood && (
				<p
					className="mt-8 text-xs font-medium tracking-widest uppercase"
					style={{ fontFamily: fonts.body, color: theme.primary }}
				>
					{analysis.compound_mood}
				</p>
			)}

			<ContinueButton
				theme={theme}
				isNavigating={isNavigating}
				onClick={handleContinue}
			/>
		</div>
	);
}

function ContinueButton({
	theme,
	isNavigating,
	onClick,
}: {
	theme: ReturnType<typeof useTheme>;
	isNavigating: boolean;
	onClick: () => void;
}) {
	return (
		<>
			<button
				type="button"
				onClick={onClick}
				disabled={isNavigating}
				className="group mt-12 inline-flex min-h-11 items-center gap-3"
				style={{
					fontFamily: fonts.body,
					color: theme.text,
					opacity: isNavigating ? 0.5 : 1,
				}}
			>
				<span className="text-lg font-medium tracking-wide">
					See Your Matches
				</span>
				<span
					className="inline-block transition-transform group-hover:translate-x-1"
					style={{ color: theme.textMuted }}
				>
					→
				</span>
			</button>

			<div className="mt-4 flex items-center justify-center gap-1.5">
				<span
					className="text-xs"
					style={{ color: theme.textMuted, opacity: 0.6 }}
				>
					or press
				</span>
				<Kbd
					style={{
						color: theme.textMuted,
						backgroundColor: `${theme.text}10`,
						border: `1px solid ${theme.textMuted}30`,
						boxShadow: `0 1px 0 ${theme.textMuted}20`,
					}}
				>
					⏎
				</Kbd>
			</div>
		</>
	);
}
