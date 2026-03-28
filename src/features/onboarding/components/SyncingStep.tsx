/**
 * Syncing step - shows real-time progress from the extension during onboarding.
 * Auto-advances to flag-playlists when the extension reports a completed sync.
 */

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import {
	type ExtensionSyncState,
	getExtensionStatus,
	triggerExtensionSync,
} from "@/lib/extension/detect";
import { useSmoothProgress } from "@/lib/hooks/useSmoothProgress";
import type { PhaseJobIds } from "@/lib/platform/jobs/progress/types";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";

const EXTENSION_STATUS_POLL_MS = 1_000;
const SYNC_TRIGGER_RETRY_MS = 2_000;
const UPLOAD_PHASE_WEIGHT = 0.08;

const COUNTER_KEYS = [
	"likedSongs",
	"playlists",
	"playlistTracks",
	"artistImages",
] as const;

const PHASE_ORDER = [
	"likedSongs",
	"playlists",
	"playlistTracks",
	"artistImages",
	"uploading",
] as const;

type CounterKey = (typeof COUNTER_KEYS)[number];

type PhaseCounter = {
	count: number;
	total: number;
};

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function useExtensionSyncStatus(): ExtensionSyncState | null {
	const [syncState, setSyncState] = useState<ExtensionSyncState | null>(null);
	const latestStateRef = useRef<ExtensionSyncState | null>(null);

	useEffect(() => {
		let isCancelled = false;

		const pollStatus = async () => {
			const response = await getExtensionStatus();
			if (isCancelled) {
				return;
			}

			const nextState = response?.sync ?? null;
			latestStateRef.current = nextState;
			setSyncState(nextState);
		};

		const triggerIfIdle = () => {
			const status = latestStateRef.current?.status;
			if (status == null || status === "idle") {
				triggerExtensionSync();
			}
		};

		triggerExtensionSync();
		void pollStatus();

		const pollInterval = setInterval(() => {
			void pollStatus();
		}, EXTENSION_STATUS_POLL_MS);
		const triggerInterval = setInterval(triggerIfIdle, SYNC_TRIGGER_RETRY_MS);

		return () => {
			isCancelled = true;
			clearInterval(pollInterval);
			clearInterval(triggerInterval);
		};
	}, []);

	return syncState;
}

function calculateCombinedProgress(
	syncState: ExtensionSyncState | null,
): number {
	if (!syncState) {
		return 0;
	}

	if (syncState.status === "done") {
		return 100;
	}

	const currentPhaseIndex =
		syncState.phase === "idle" ? -1 : PHASE_ORDER.indexOf(syncState.phase);
	const dataPhaseWeight = 1 - UPLOAD_PHASE_WEIGHT;
	const totals = COUNTER_KEYS.map((key) => syncState[key].total);
	const grandTotal = totals.reduce((sum, total) => sum + total, 0);
	const allTotalsKnown = grandTotal > 0 && totals.every((total) => total > 0);

	let weightedProgress = 0;

	for (const [index, key] of COUNTER_KEYS.entries()) {
		const counter = syncState[key];
		const phaseWeight = allTotalsKnown
			? (counter.total / grandTotal) * dataPhaseWeight
			: dataPhaseWeight / COUNTER_KEYS.length;

		let phaseProgress = 0;
		if (currentPhaseIndex > index || syncState.phase === "uploading") {
			phaseProgress = 1;
		} else if (currentPhaseIndex === index) {
			phaseProgress =
				counter.total > 0 ? clamp(counter.fetched / counter.total, 0, 1) : 0;
		}

		weightedProgress += phaseProgress * phaseWeight;
	}

	if (syncState.phase === "uploading") {
		weightedProgress += UPLOAD_PHASE_WEIGHT * 0.9;
	}

	return weightedProgress * 100;
}

function getSyncLabel(syncState: ExtensionSyncState | null): string {
	if (!syncState || syncState.status === "idle") {
		return "Discovering your library...";
	}

	if (syncState.status === "done") {
		return "Complete!";
	}

	if (syncState.status === "error") {
		return "Sync failed";
	}

	switch (syncState.phase) {
		case "likedSongs":
			return "Reading liked songs...";
		case "playlists":
			return "Scanning playlists...";
		case "playlistTracks":
			return "Loading playlist tracks...";
		case "artistImages":
			return "Fetching artists...";
		case "uploading":
			return "Sending everything to hearted...";
		default:
			return "Discovering your library...";
	}
}

function formatCounterLine(
	label: string,
	counter: PhaseCounter,
): string | null {
	if (counter.total > 0) {
		return `${counter.count.toLocaleString()}/${counter.total.toLocaleString()} ${label}`;
	}

	if (counter.count > 0) {
		return `${counter.count.toLocaleString()} ${label}`;
	}

	return null;
}

function getDisplayCounter(
	syncState: ExtensionSyncState | null,
	key: CounterKey,
): PhaseCounter {
	const counter = syncState?.[key] ?? { fetched: 0, total: 0 };
	const isDone = syncState?.status === "done";

	return {
		count: isDone && counter.total > 0 ? counter.total : counter.fetched,
		total: counter.total,
	};
}

function hasVisibleProgress(counters: PhaseCounter[]): boolean {
	return counters.some((counter) => counter.count > 0 || counter.total > 0);
}

interface SyncingStepProps {
	phaseJobIds: PhaseJobIds | null;
}

export function SyncingStep({ phaseJobIds: _phaseJobIds }: SyncingStepProps) {
	const theme = useTheme();
	const { goToStep } = useOnboardingNavigation();
	const syncState = useExtensionSyncStatus();

	const { phaseCounts, counters } = useMemo(() => {
		const counts = {
			songs: getDisplayCounter(syncState, "likedSongs"),
			playlists: getDisplayCounter(syncState, "playlists"),
			playlistTracks: getDisplayCounter(syncState, "playlistTracks"),
			artistImages: getDisplayCounter(syncState, "artistImages"),
		};
		return {
			phaseCounts: counts,
			counters: [
				counts.playlists,
				counts.playlistTracks,
				counts.songs,
				counts.artistImages,
			],
		};
	}, [syncState]);

	const isFailed = syncState?.status === "error";
	const allComplete = syncState?.status === "done";
	const isDiscovering = !hasVisibleProgress(counters) && !isFailed;
	const percent = calculateCombinedProgress(syncState);
	const label = getSyncLabel(syncState);
	const syncProgress = useSmoothProgress(percent, allComplete);
	const error = syncState?.error ?? null;

	const onSyncComplete = useEffectEvent(() => {
		goToStep("flag-playlists", {
			syncStats: {
				songs: phaseCounts.songs.count,
				playlists: phaseCounts.playlists.count,
			},
		});
	});

	useEffect(() => {
		if (allComplete) {
			const timer = setTimeout(onSyncComplete, 1500);
			return () => clearTimeout(timer);
		}
	}, [allComplete]);

	if (isFailed) {
		return (
			<div className="text-center">
				<p
					className="text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Error
				</p>

				<h2
					className="mt-4 text-5xl leading-tight font-extralight"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					Something went
					<br />
					<em className="font-normal">wrong</em>
				</h2>

				<p
					className="mt-6 text-lg font-light"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					{error || "We encountered an error while syncing your library."}
				</p>

				<button
					type="button"
					onClick={() => {
						window.location.href = "/onboarding?step=welcome";
					}}
					className="group mt-16 inline-flex items-center gap-3"
					style={{ fontFamily: fonts.body, color: theme.text }}
				>
					<span className="text-lg font-medium tracking-wide">Start Over</span>
					<span
						className="inline-block transition-transform group-hover:translate-x-1"
						style={{ color: theme.textMuted }}
					>
						→
					</span>
				</button>
			</div>
		);
	}

	const counterLines = [
		formatCounterLine("playlists", phaseCounts.playlists),
		formatCounterLine("playlist tracks", phaseCounts.playlistTracks),
		formatCounterLine("liked songs", phaseCounts.songs),
		formatCounterLine("artists", phaseCounts.artistImages),
	].filter((value): value is string => value !== null);

	return (
		<div className="text-center">
			<p
				className="text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				Syncing
			</p>

			<h2
				className="mt-4 text-5xl leading-tight font-extralight"
				style={{ fontFamily: fonts.display, color: theme.text }}
			>
				Listening to your
				<br />
				<em className="font-normal">library</em>
			</h2>

			<div className="mt-12 flex items-baseline justify-center">
				<span
					className="text-8xl font-light tabular-nums"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					{Math.floor(syncProgress)}
				</span>
				<span className="text-4xl" style={{ color: theme.textMuted }}>
					%
				</span>
			</div>

			{isDiscovering ? (
				<div
					className="mt-8 space-y-1 text-sm animate-pulse"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					<p>{label}</p>
				</div>
			) : (
				<div
					className="mt-8 space-y-1 text-sm"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					{counterLines.map((line) => (
						<p key={line}>{line}</p>
					))}
					<p className="mt-2">{label}</p>
				</div>
			)}
		</div>
	);
}
