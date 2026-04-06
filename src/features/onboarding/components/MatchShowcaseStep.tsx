/**
 * Match showcase step — displays live match results for the demo song
 * against the user's real target playlists.
 * Falls back to a canned result after a timeout to avoid blocking onboarding.
 * Demo song is outside monetization: no credits, no unlocks.
 */

import { useEffect, useRef, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import {
	getDemoSongMatches,
	getDemoSongShowcase,
	type DemoMatchPlaylist,
	type DemoSongData,
} from "@/lib/server/onboarding.functions";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";

const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 12_000;

const CANNED_MATCHES: DemoMatchPlaylist[] = [
	{
		id: "canned-1",
		name: "Your top playlist",
		description: null,
		songCount: null,
		score: 0.92,
	},
	{
		id: "canned-2",
		name: "A great fit",
		description: null,
		songCount: null,
		score: 0.85,
	},
];

type MatchState =
	| { status: "loading" }
	| { status: "ready"; matches: DemoMatchPlaylist[]; isCanned: boolean }
	| { status: "unavailable" };

export function MatchShowcaseStep() {
	const theme = useTheme();
	const { goToStep } = useOnboardingNavigation();
	const [isNavigating, setIsNavigating] = useState(false);
	const [matchState, setMatchState] = useState<MatchState>({
		status: "loading",
	});
	const [songData, setSongData] = useState<DemoSongData | null>(null);
	const timedOutRef = useRef(false);

	useEffect(() => {
		let cancelled = false;
		getDemoSongShowcase()
			.then((data) => {
				if (!cancelled) setSongData(data);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		let pollTimer: ReturnType<typeof setTimeout> | null = null;

		const timeoutTimer = setTimeout(() => {
			if (cancelled) return;
			timedOutRef.current = true;
			setMatchState((prev) => {
				if (prev.status === "loading") {
					return {
						status: "ready",
						matches: CANNED_MATCHES,
						isCanned: true,
					};
				}
				return prev;
			});
		}, TIMEOUT_MS);

		async function poll() {
			if (cancelled || timedOutRef.current) return;
			try {
				const result = await getDemoSongMatches();
				if (cancelled) return;

				if (result.status === "ready") {
					setMatchState({
						status: "ready",
						matches:
							result.matches.length > 0 ? result.matches : CANNED_MATCHES,
						isCanned: result.matches.length === 0,
					});
					return;
				}

				if (result.status === "unavailable") {
					setMatchState({ status: "unavailable" });
					return;
				}

				pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
			} catch {
				if (!cancelled && !timedOutRef.current) {
					pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
				}
			}
		}

		poll();

		return () => {
			cancelled = true;
			clearTimeout(timeoutTimer);
			if (pollTimer) clearTimeout(pollTimer);
		};
	}, []);

	const handleContinue = async () => {
		if (isNavigating) return;
		setIsNavigating(true);
		try {
			await goToStep("plan-selection");
		} catch {
			setIsNavigating(false);
		}
	};

	useShortcut({
		key: "enter",
		handler: handleContinue,
		description: "Continue",
		scope: "onboarding-match-showcase",
		enabled: !isNavigating && matchState.status !== "loading",
	});

	if (matchState.status === "loading") {
		return (
			<div className="text-center">
				<p
					className="text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Match Showcase
				</p>
				<h2
					className="mt-4 text-4xl leading-tight font-extralight"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					Finding the perfect playlists...
				</h2>
				<div className="mt-8 flex justify-center">
					<div
						className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
						style={{ borderColor: theme.border, borderTopColor: "transparent" }}
					/>
				</div>
				<p
					className="mt-4 text-sm font-light"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Matching your demo song against your playlists...
				</p>
			</div>
		);
	}

	if (matchState.status === "unavailable") {
		return (
			<div className="text-center">
				<p
					className="text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Match Showcase
				</p>
				<h2
					className="mt-4 text-4xl leading-tight font-extralight"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					This is how matching works.
				</h2>
				<p
					className="mt-6 text-lg font-light"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					hearted. matches every song to the playlists where it belongs best.
				</p>
				<ContinueButton
					theme={theme}
					isNavigating={isNavigating}
					onClick={handleContinue}
				/>
			</div>
		);
	}

	const { matches, isCanned } = matchState;
	const topMatches = matches.slice(0, 5);

	return (
		<div className="text-center">
			<p
				className="text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				{isCanned ? "Here's what to expect" : "Your matches"}
			</p>

			{songData && (
				<div className="mt-4 flex flex-col items-center gap-2">
					{songData.song.imageUrl && (
						<img
							src={songData.song.imageUrl}
							alt={`${songData.song.name} album art`}
							className="h-16 w-16 rounded-lg object-cover shadow-md"
						/>
					)}
					<div>
						<p
							className="text-lg font-light"
							style={{ fontFamily: fonts.display, color: theme.text }}
						>
							{songData.song.name}
						</p>
						<p
							className="text-xs"
							style={{ fontFamily: fonts.body, color: theme.textMuted }}
						>
							{songData.song.artists.join(", ")}
						</p>
					</div>
				</div>
			)}

			<h2
				className="mt-6 text-3xl leading-tight font-extralight"
				style={{ fontFamily: fonts.display, color: theme.text }}
			>
				{isCanned
					? "Matching is still running"
					: "We found where this song belongs."}
			</h2>

			<div className="mx-auto mt-8 max-w-sm space-y-3">
				{topMatches.map((match, i) => (
					<div
						key={match.id}
						className="flex items-center gap-3 rounded-lg px-4 py-3 text-left"
						style={{
							border: `1px solid ${theme.border}`,
							background: i === 0 ? `${theme.primary}08` : "transparent",
						}}
					>
						<span
							className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium"
							style={{
								background: i === 0 ? theme.primary : theme.border,
								color: i === 0 ? theme.bg : theme.text,
							}}
						>
							{i + 1}
						</span>
						<div className="min-w-0 flex-1">
							<p
								className="truncate text-sm font-medium"
								style={{
									fontFamily: fonts.body,
									color: theme.text,
								}}
							>
								{isCanned ? match.name : match.name}
							</p>
							{!isCanned && match.songCount !== null && (
								<p
									className="text-xs"
									style={{
										fontFamily: fonts.body,
										color: theme.textMuted,
									}}
								>
									{match.songCount} songs
								</p>
							)}
						</div>
						<span
							className="shrink-0 text-xs font-medium tabular-nums"
							style={{
								fontFamily: fonts.body,
								color: theme.primary,
							}}
						>
							{Math.round(match.score * 100)}%
						</span>
					</div>
				))}
			</div>

			{isCanned && (
				<p
					className="mx-auto mt-4 max-w-sm text-xs font-light"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Matching is still processing — you'll see real results on your
					dashboard.
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
					Choose Your Plan
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
