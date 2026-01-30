/**
 * Connecting step - pre-fetches Spotify library summary.
 *
 * Fetches totals (songs, playlists, tracks) BEFORE navigating to SyncingStep:
 * - Immediate progress display with known totals
 * - Cached playlists reused in sync (no duplicate API calls)
 */

import { useEffect, useEffectEvent, useState, useCallback } from "react";
import { toast } from "sonner";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";
import { getLibrarySummary } from "@/lib/server/onboarding.server";

interface ConnectingStepProps {
	theme: ThemeConfig;
}

export function ConnectingStep({ theme }: ConnectingStepProps) {
	const { goToStep } = useOnboardingNavigation();
	const [isFetchingSummary, setIsFetchingSummary] = useState(true);
	const [error, setError] = useState<Error | null>(null);

	const handleFetchSummary = useCallback(async () => {
		setIsFetchingSummary(true);
		setError(null);

		try {
			const librarySummary = await getLibrarySummary();
			await goToStep("syncing", { librarySummary });
		} catch (e) {
			const err =
				e instanceof Error ? e : new Error("Failed to fetch library summary");
			setError(err);
			toast.error("Couldn't connect to Spotify. Please try again.");
		} finally {
			setIsFetchingSummary(false);
		}
	}, [goToStep]);

	const onMount = useEffectEvent(() => {
		handleFetchSummary();
	});

	useEffect(() => {
		onMount();
	}, []);

	return (
		<div className="text-center">
			<p
				className="text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				{error ? "Connection Failed" : "Connecting"}
			</p>

			<h2
				className="mt-4 text-5xl leading-tight font-extralight"
				style={{ fontFamily: fonts.display, color: theme.text }}
			>
				{error ? (
					<>
						Couldn&apos;t reach
						<br />
						<span className="font-normal">Spotify</span>
					</>
				) : (
					<>
						Linking to
						<br />
						<span className="font-normal">Spotify</span>
					</>
				)}
			</h2>

			<div className="mt-16 flex justify-center">
				{error ? (
					<button
						onClick={handleFetchSummary}
						disabled={isFetchingSummary}
						className="rounded-lg px-6 py-3 text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
						style={{
							fontFamily: fonts.body,
							background: theme.text,
							color: theme.bg,
						}}
					>
						{isFetchingSummary ? "Retrying..." : "Try Again"}
					</button>
				) : (
					<div className="flex gap-2">
						{[0, 1, 2].map((i) => (
							<div
								key={i}
								className="h-2 w-2 animate-pulse rounded-full"
								style={{
									background: theme.text,
									animationDelay: `${i * 200}ms`,
								}}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
