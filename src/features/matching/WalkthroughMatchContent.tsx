import { useEffect, useRef, useState } from "react";
import { getDemoMatchesForSong } from "@/lib/data/demo-matches";
import {
	getDemoSongMatches,
	type DemoMatchPlaylist,
} from "@/lib/server/onboarding.functions";
import type { WalkthroughSong } from "@/features/onboarding/step-resolver";
import { useStepNavigation } from "@/features/onboarding/hooks/useStepNavigation";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { MatchingHeader } from "./sections/MatchingHeader";
import { MatchingSession } from "./sections/MatchingSession";
import { SongSection } from "./components/SongSection";
import type { Playlist, SongForMatching } from "./types";

const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 12_000;

type MatchState =
	| { status: "loading" }
	| { status: "ready"; matches: Playlist[] };

function mapServerMatches(matches: DemoMatchPlaylist[]): Playlist[] {
	return matches.slice(0, 5).map((m) => ({
		id: m.id,
		name: m.name,
		reason: m.description ?? "",
		matchScore: m.score,
	}));
}

function mapDemoMatches(spotifyTrackId: string): Playlist[] {
	const demoMatches = getDemoMatchesForSong(spotifyTrackId);
	return demoMatches.slice(0, 5).map((m) => ({
		id: m.id,
		name: m.name,
		reason: m.reason,
		matchScore: m.matchScore,
	}));
}

function songToMatchingSong(song: WalkthroughSong): SongForMatching {
	return {
		id: song.id,
		name: song.name,
		artist: song.artist,
		album: song.album,
		albumArtUrl: song.albumArtUrl,
		genres: [],
		analysis: null,
	};
}

export function WalkthroughMatchContent({
	walkthroughSong,
}: {
	walkthroughSong: WalkthroughSong;
}) {
	const theme = useTheme();
	const { navigateTo, isPending } = useStepNavigation();
	const [matchState, setMatchState] = useState<MatchState>({
		status: "loading",
	});
	const timedOutRef = useRef(false);

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
						matches: mapDemoMatches(walkthroughSong.spotifyTrackId),
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
						matches: mapServerMatches(result.matches),
					});
					return;
				}

				if (result.status === "unavailable") {
					setMatchState({
						status: "ready",
						matches: mapDemoMatches(walkthroughSong.spotifyTrackId),
					});
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
	}, [walkthroughSong.spotifyTrackId]);

	const currentSong = songToMatchingSong(walkthroughSong);
	const isLoading = matchState.status === "loading";

	const handleWalkthroughAction = async () => {
		if (isPending.current) return;
		await navigateTo("plan-selection");
	};

	if (isLoading) {
		return (
			<div className="mx-auto w-full max-w-[min(1600px,100%)]">
				<MatchingHeader currentIndex={0} totalSongs={1} />
				<div className="mb-10 h-px" style={{ background: theme.border }} />
				<div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
					<SongSection
						songKey={currentSong.id}
						song={{
							name: currentSong.name,
							album: currentSong.album ?? "",
							artist: currentSong.artist,
						}}
						metaVisible={true}
						albumArtUrl={currentSong.albumArtUrl ?? undefined}
						isLoading={false}
					/>
					<MatchesSkeleton />
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto w-full max-w-[min(1600px,100%)]">
			<MatchingHeader currentIndex={0} totalSongs={1} />
			<MatchingSession
				currentSong={currentSong}
				playlists={matchState.matches}
				addedTo={[]}
				state={{ songMetaVisible: true }}
				onAdd={handleWalkthroughAction}
				onDismiss={handleWalkthroughAction}
				onNext={handleWalkthroughAction}
			/>
		</div>
	);
}

function MatchesSkeleton() {
	const theme = useTheme();
	return (
		<div
			className="flex flex-col"
			style={{ minHeight: "clamp(300px, 30vw, 560px)" }}
		>
			<p
				className="text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				Best Matches
			</p>
			<div className="mt-6 space-y-5">
				{[0.7, 0.55, 0.4].map((width, i) => (
					<div
						key={i}
						className="flex items-start gap-3 pb-5"
						style={{ borderBottom: `1px solid ${theme.border}` }}
					>
						<div
							className="h-8 w-12 animate-pulse rounded"
							style={{ background: theme.surface }}
						/>
						<div className="flex-1 space-y-2">
							<div
								className="h-4 animate-pulse rounded"
								style={{ background: theme.surface, width: `${width * 100}%` }}
							/>
							<div
								className="h-3 animate-pulse rounded"
								style={{ background: theme.surface, width: `${width * 70}%` }}
							/>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
