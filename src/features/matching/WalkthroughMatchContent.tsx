import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useSyncExternalStore,
} from "react";
import { useStepNavigation } from "@/features/onboarding/hooks/useStepNavigation";
import { PaneStore } from "@/integrations/uipane";
import { getDemoMatchesForSong } from "@/lib/content/landing/demo-matches";
import type { WalkthroughSong } from "@/lib/domains/library/accounts/onboarding-session";
import {
	type DemoMatchPlaylist,
	getDemoSongMatches,
} from "@/lib/server/onboarding.functions";
import { fonts } from "@/lib/theme/fonts";
import { SongSection } from "./components/SongSection";
import { MatchingHeader } from "./sections/MatchingHeader";
import { MatchingSession } from "./sections/MatchingSession";
import type { Playlist, SongForMatching } from "./types";

const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 12_000;

type MatchSource = "real" | "fallback";

type MatchState =
	| { status: "loading" }
	| {
			status: "ready";
			matches: Playlist[];
			fallbackMatches: Playlist[];
			source: MatchSource;
			pendingRealMatches: Playlist[] | null;
	  };

type MatchAction =
	| { type: "started" }
	| { type: "timedOut"; fallbackMatches: Playlist[] }
	| {
			type: "serverReady";
			matches: Playlist[];
			fallbackMatches: Playlist[];
			source: MatchSource;
			hasTimedOut: boolean;
	  }
	| { type: "unavailable"; fallbackMatches: Playlist[] }
	| { type: "acceptPendingRealMatches" };

const initialMatchState: MatchState = { status: "loading" };

function matchReducer(state: MatchState, action: MatchAction): MatchState {
	switch (action.type) {
		case "started":
			return initialMatchState;
		case "timedOut":
			if (state.status !== "loading") return state;
			return {
				status: "ready",
				matches: action.fallbackMatches,
				fallbackMatches: action.fallbackMatches,
				source: "fallback",
				pendingRealMatches: null,
			};
		case "serverReady":
			if (
				action.hasTimedOut &&
				state.status === "ready" &&
				action.source === "real"
			) {
				return { ...state, pendingRealMatches: action.matches };
			}
			return {
				status: "ready",
				matches: action.matches,
				fallbackMatches: action.fallbackMatches,
				source: action.source,
				pendingRealMatches: null,
			};
		case "unavailable":
			return {
				status: "ready",
				matches: action.fallbackMatches,
				fallbackMatches: action.fallbackMatches,
				source: "fallback",
				pendingRealMatches: null,
			};
		case "acceptPendingRealMatches":
			if (state.status !== "ready" || !state.pendingRealMatches) return state;
			return {
				...state,
				matches: state.pendingRealMatches,
				source: "real",
				pendingRealMatches: null,
			};
	}
}

function mapServerMatches(matches: DemoMatchPlaylist[]): Playlist[] {
	return matches.slice(0, 5).map((m) => ({
		id: m.id,
		spotifyId: "",
		name: m.name,
		reason: m.description ?? "",
		matchScore: m.score,
	}));
}

function mapDemoMatches(spotifyTrackId: string): Playlist[] {
	const demoMatches = getDemoMatchesForSong(spotifyTrackId);
	return demoMatches.slice(0, 5).map((m) => ({
		id: m.id,
		spotifyId: m.spotifyId,
		name: m.name,
		reason: m.reason,
		matchScore: m.matchScore,
	}));
}

function songToMatchingSong(song: WalkthroughSong): SongForMatching {
	return {
		id: song.id,
		spotifyId: "",
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
	const { navigateTo, isPending } = useStepNavigation();
	const [matchState, dispatchMatch] = useReducer(
		matchReducer,
		initialMatchState,
	);
	const timedOutRef = useRef(false);

	useEffect(() => {
		let cancelled = false;
		let pollTimer: ReturnType<typeof setTimeout> | null = null;

		timedOutRef.current = false;
		dispatchMatch({ type: "started" });

		const fallback = mapDemoMatches(walkthroughSong.spotifyTrackId);

		const timeoutTimer = setTimeout(() => {
			if (cancelled) return;
			timedOutRef.current = true;
			dispatchMatch({ type: "timedOut", fallbackMatches: fallback });
		}, TIMEOUT_MS);

		async function poll() {
			if (cancelled) return;
			try {
				const result = await getDemoSongMatches();
				if (cancelled) return;

				if (result.status === "ready") {
					const serverMatches = mapServerMatches(result.matches);
					const source: MatchSource = result.isDemo ? "fallback" : "real";

					dispatchMatch({
						type: "serverReady",
						matches: serverMatches,
						fallbackMatches: fallback,
						source,
						hasTimedOut: timedOutRef.current,
					});
					return;
				}

				if (result.status === "unavailable") {
					dispatchMatch({ type: "unavailable", fallbackMatches: fallback });
					return;
				}

				pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
			} catch {
				if (!cancelled) {
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

	const paneViewSource = usePaneMatchSource();

	const currentSong = useMemo(
		() => songToMatchingSong(walkthroughSong),
		[walkthroughSong],
	);

	const songDisplay = useMemo(
		() => ({
			name: currentSong.name,
			album: currentSong.album ?? "",
			artist: currentSong.artist,
		}),
		[currentSong.name, currentSong.album, currentSong.artist],
	);

	const isLoading = matchState.status === "loading";

	const handleWalkthroughAction = useCallback(async () => {
		if (isPending) return;
		await navigateTo("install-extension");
	}, [isPending, navigateTo]);

	const hasRealPending =
		matchState.status === "ready" && matchState.pendingRealMatches !== null;
	const paneRealAvailable = usePaneRealAvailable();
	const realAvailable = hasRealPending || paneRealAvailable;

	const handleRefresh = useCallback(() => {
		if (hasRealPending) {
			dispatchMatch({ type: "acceptPendingRealMatches" });
		}
		clearPaneRealAvailable();
	}, [hasRealPending]);

	useSyncPaneRealAvailable(hasRealPending);

	const effectiveSource: MatchSource =
		matchState.status === "ready"
			? paneViewSource === "fallback"
				? "fallback"
				: matchState.source
			: "fallback";

	const displayedMatches =
		matchState.status === "ready"
			? effectiveSource === "fallback"
				? matchState.fallbackMatches
				: matchState.matches
			: [];

	if (isLoading) {
		return (
			<div className="mx-auto w-full max-w-[min(1600px,100%)]">
				<MatchingHeader currentIndex={0} totalSongs={1} />
				<div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
					<SongSection
						songKey={currentSong.id}
						song={songDisplay}
						albumArtUrl={currentSong.albumArtUrl ?? undefined}
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
				playlists={displayedMatches}
				addedTo={[]}
				isDemo={effectiveSource === "fallback"}
				realAvailable={realAvailable}
				onRefresh={handleRefresh}
				onAdd={handleWalkthroughAction}
				onDismiss={handleWalkthroughAction}
				onNext={handleWalkthroughAction}
			/>
		</div>
	);
}

// --- Dev-only pane integration (inert in production) ---

const DEV = import.meta.env.DEV;
const ONBOARDING_PANE_NAME = "Onboarding";
const MATCH_ENABLED_PATH = "matching.enabled";
const MATCH_SOURCE_PATH = "matching.matchSource";
const REAL_AVAILABLE_PATH = "realAvailable";
const noop = () => {};

function getPaneId(): string | undefined {
	return PaneStore.getPanels().find((p) => p.name === ONBOARDING_PANE_NAME)?.id;
}

function isMatchingDebugEnabled(): boolean {
	const id = getPaneId();
	if (!id) return false;
	return (PaneStore.getValues(id)[MATCH_ENABLED_PATH] as boolean) ?? false;
}

function usePaneMatchSource(): MatchSource {
	const isReal = useSyncExternalStore(
		(cb) => {
			if (!DEV) return noop;
			const id = getPaneId();
			if (!id) return noop;
			return PaneStore.subscribe(id, cb);
		},
		() => {
			if (!DEV || !isMatchingDebugEnabled()) return true;
			const id = getPaneId();
			if (!id) return true;
			return (PaneStore.getValues(id)[MATCH_SOURCE_PATH] as boolean) ?? true;
		},
		() => true,
	);
	return isReal ? "real" : "fallback";
}

function usePaneRealAvailable(): boolean {
	return useSyncExternalStore(
		(cb) => {
			if (!DEV) return noop;
			const id = getPaneId();
			if (!id) return noop;
			return PaneStore.subscribe(id, cb);
		},
		() => {
			if (!DEV || !isMatchingDebugEnabled()) return false;
			const id = getPaneId();
			if (!id) return false;
			return (PaneStore.getValues(id)[REAL_AVAILABLE_PATH] as boolean) ?? false;
		},
		() => false,
	);
}

function clearPaneRealAvailable() {
	if (!DEV) return;
	const id = getPaneId();
	if (id) PaneStore.updateValue(id, REAL_AVAILABLE_PATH, false);
}

function useSyncPaneRealAvailable(realAvailable: boolean) {
	useEffect(() => {
		if (!DEV) return;
		const id = getPaneId();
		if (id) PaneStore.updateValue(id, REAL_AVAILABLE_PATH, realAvailable);
	}, [realAvailable]);
}

function MatchesSkeleton() {
	return (
		<div
			className="flex flex-col"
			style={{ minHeight: "clamp(300px, 30vw, 560px)" }}
		>
			<p
				className="theme-text-muted text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				Best Matches
			</p>
			<div className="mt-6 space-y-5">
				{[
					{ id: "wide", width: 0.7 },
					{ id: "medium", width: 0.55 },
					{ id: "narrow", width: 0.4 },
				].map(({ id, width }) => (
					<div
						key={id}
						className="theme-border-color flex items-start gap-3 border-b pb-5"
					>
						<div className="theme-surface-bg h-8 w-12 animate-pulse rounded" />
						<div className="flex-1 space-y-2">
							<div
								className="theme-surface-bg h-4 animate-pulse rounded"
								style={{ width: `${width * 100}%` }}
							/>
							<div
								className="theme-surface-bg h-3 animate-pulse rounded"
								style={{ width: `${width * 70}%` }}
							/>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
