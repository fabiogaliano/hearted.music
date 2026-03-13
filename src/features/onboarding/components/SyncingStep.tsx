/**
 * Syncing step - shows real-time progress from 3 separate phase jobs.
 * Auto-advances to flag-playlists on completion.
 *
 * PhaseJobIds are created by the extension sync endpoint (/api/extension/sync).
 * If not yet available (extension hasn't triggered), polls DB until they appear.
 */

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import {
	type JobProgressState,
	useJobProgress,
} from "@/lib/hooks/useJobProgress";
import { triggerExtensionSync } from "@/lib/extension/detect";
import type { PhaseJobIds } from "@/lib/platform/jobs/progress/types";
import { pollPhaseJobIds } from "@/lib/server/onboarding.functions";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";

const WAVEFORM_HEIGHTS = [4, 7, 11, 15, 18, 20, 18, 15, 11, 7, 4];

function WaitingWaveform({ color }: { color: string }) {
	return (
		<>
			<style>{`
				@keyframes wfSync {
					0%, 100% { transform: scaleY(0.15); }
					50% { transform: scaleY(1); }
				}
				@media (prefers-reduced-motion: reduce) {
					.wf-sync { animation: none !important; transform: scaleY(0.4) !important; }
				}
			`}</style>
			<div
				className="flex items-center justify-center"
				style={{ gap: 2, height: 20, opacity: 0.4 }}
			>
				{WAVEFORM_HEIGHTS.map((h, i) => (
					<div
						key={i}
						className="wf-sync"
						style={{
							width: 1.5,
							height: h,
							background: color,
							transformOrigin: "center",
							animation: `wfSync 2.2s cubic-bezier(0.4, 0, 0.2, 1) ${i * 100}ms infinite`,
						}}
					/>
				))}
			</div>
		</>
	);
}

/**
 * Smart smooth progress with predictive velocity and fast completion catch-up.
 *
 * Problem: Spotify API returns progress in batches of 50 items, causing jumps.
 * Old approach used slow velocity blending (98/2) that couldn't catch up at completion.
 *
 * New approach:
 * 1. RATE TRACKING: Use exponential smoothing to estimate API batch arrival rate
 * 2. PREDICTIVE VELOCITY: Set velocity to arrive at ~95% just before completion
 * 3. PROPORTIONAL CATCH-UP: When complete, use LERP for fast but smooth finish
 *
 * Key insight: We know totals upfront, so we can predict when sync will finish
 * based on batch arrival rate and adjust velocity accordingly.
 */
function useSmoothProgress(target: number, isComplete: boolean): number {
	// Algorithm tuning constants
	const ALPHA = 0.4; // Exponential smoothing factor (0.4 = balanced responsiveness)
	const MIN_VELOCITY = 0.02; // ~1.2%/sec minimum (never appear stuck)
	const MAX_VELOCITY = 0.15; // ~9%/sec maximum (never jump too fast)
	const CEILING_BUFFER = 6; // Stay this far behind actual progress
	const COMPLETION_LERP = 0.08; // Fast LERP factor when complete (~5 frames to 95%)

	const [display, setDisplay] = useState(0);
	const displayRef = useRef(0);
	const velocityRef = useRef(MIN_VELOCITY);
	const animationRef = useRef<number | null>(null);

	const lastTargetRef = useRef(0);
	const lastTargetTimeRef = useRef(Date.now());
	const smoothedRateRef = useRef(0); // Smoothed rate in %/ms

	const targetRef = useRef(target);
	const isCompleteRef = useRef(isComplete);
	targetRef.current = target;
	isCompleteRef.current = isComplete;

	useEffect(() => {
		const animate = () => {
			const prev = displayRef.current;
			const actualTarget = targetRef.current;
			const complete = isCompleteRef.current;
			const now = Date.now();

			if (prev >= 99.9) {
				displayRef.current = 100;
				setDisplay(100);
				return;
			}

			if (actualTarget === 0 && !complete) {
				animationRef.current = requestAnimationFrame(animate);
				return;
			}

			if (actualTarget > lastTargetRef.current) {
				const deltaTarget = actualTarget - lastTargetRef.current;
				const deltaTime = Math.max(now - lastTargetTimeRef.current, 1);
				const instantRate = deltaTarget / deltaTime; // %/ms

				// Exponential smoothing: rate = α × instant + (1-α) × previous
				if (smoothedRateRef.current === 0) {
					smoothedRateRef.current = instantRate; // Initialize
				} else {
					smoothedRateRef.current =
						ALPHA * instantRate + (1 - ALPHA) * smoothedRateRef.current;
				}

				lastTargetRef.current = actualTarget;
				lastTargetTimeRef.current = now;
			}

			let newDisplay: number;

			if (complete) {
				// COMPLETION MODE: Fast LERP toward 100%
				// LERP: display = display + (target - display) * factor
				// With factor=0.08, reaches 95% of gap in ~35 frames (~0.6s)
				const remaining = 100 - prev;
				newDisplay = prev + remaining * COMPLETION_LERP;
			} else {
				// TRACKING MODE: Predictive velocity based on API rate
				const gap = actualTarget - prev;

				let targetVelocity: number;

				if (smoothedRateRef.current > 0) {
					// Predict: match smoothed API rate, converted to per-frame
					// Rate is %/ms, frame is ~16.67ms at 60fps
					const ratePerFrame = smoothedRateRef.current * 16.67;
					// Stay slightly behind (90%) to maintain smooth buffer
					targetVelocity = ratePerFrame * 0.9;
				} else {
					// Fallback: use gap-based velocity
					targetVelocity = MIN_VELOCITY;
				}

				// Adjust based on gap (catch up if behind, slow if ahead)
				if (gap > 20) {
					targetVelocity = Math.max(targetVelocity, MAX_VELOCITY);
				} else if (gap > 10) {
					targetVelocity = Math.max(targetVelocity * 1.3, MIN_VELOCITY * 2);
				} else if (gap < 2) {
					targetVelocity = Math.min(targetVelocity * 0.5, MIN_VELOCITY);
				}

				targetVelocity = Math.max(
					MIN_VELOCITY,
					Math.min(MAX_VELOCITY, targetVelocity),
				);

				// Smooth velocity changes (90/10 blend - responsive but not jarring)
				velocityRef.current = velocityRef.current * 0.9 + targetVelocity * 0.1;

				newDisplay = prev + velocityRef.current;

				// Apply ceiling (never get too far ahead, never reach 100 until complete)
				const ceiling = Math.min(actualTarget + CEILING_BUFFER, 99);
				newDisplay = Math.min(newDisplay, ceiling);
			}

			// Never go backwards
			newDisplay = Math.max(newDisplay, prev);

			displayRef.current = newDisplay;

			// Update React state (throttle tiny changes)
			if (Math.abs(newDisplay - prev) > 0.01) {
				setDisplay(newDisplay);
			}

			animationRef.current = requestAnimationFrame(animate);
		};

		animationRef.current = requestAnimationFrame(animate);

		return () => {
			if (animationRef.current) {
				cancelAnimationFrame(animationRef.current);
			}
		};
	}, []);

	return display;
}

/**
 * Calculate combined progress across 3 phase jobs with dynamic weights.
 * Weights are proportional to actual item counts once all totals are known.
 * Uses equal weights (33/33/33) until all phases have discovered their totals.
 */
function calculateCombinedProgress(
	songs: JobProgressState,
	playlists: JobProgressState,
	tracks: JobProgressState,
): number {
	const phases = [
		{ state: songs, itemId: "liked_songs" },
		{ state: playlists, itemId: "playlists" },
		{ state: tracks, itemId: "playlist_tracks" },
	];

	const phaseData = phases.map(({ state, itemId }) => {
		const total = state.itemTotals.get(itemId) ?? 0;
		const count = state.items.get(itemId)?.count ?? 0;
		return { state, total, count };
	});

	const grandTotal = phaseData.reduce((sum, p) => sum + p.total, 0);

	if (grandTotal === 0) {
		// No item totals received yet. If all phases are already complete by job
		// status (late subscriber missed initial emits), treat as 100% so
		// allComplete can trigger navigation.
		return phaseData.every((p) => p.state.status === "completed") ? 100 : 0;
	}

	const allTotalsKnown = phaseData.every((p) => p.total > 0);

	let weightedProgress = 0;

	for (let i = 0; i < phaseData.length; i++) {
		const { state, total, count } = phaseData[i];

		// Use dynamic weights if all totals known, otherwise equal weights
		const weight = allTotalsKnown ? total / grandTotal : 1 / 3;

		let phaseProgress = 0;

		if (state.status === "completed" || (total > 0 && count >= total)) {
			// Phase complete - 100% (either by status or by count reaching total)
			phaseProgress = 1;
		} else if (total > 0 && count > 0) {
			// In progress - use actual count
			phaseProgress = count / total;
		}
		// If count is 0 or total unknown, phaseProgress stays 0

		weightedProgress += phaseProgress * weight;
	}

	// Return decimal for smoother progress updates (display rounds with toFixed)
	return weightedProgress * 100;
}

const POLL_INTERVAL_MS = 2_000;

/**
 * Polls for phaseJobIds when they're not yet available.
 * Used when the extension hasn't triggered sync yet — the sync endpoint
 * persists phaseJobIds to user_preferences, so we poll until they appear.
 */
function usePolledPhaseJobIds(
	initialJobIds: PhaseJobIds | null,
): PhaseJobIds | null {
	const [jobIds, setJobIds] = useState<PhaseJobIds | null>(initialJobIds);
	const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		if (initialJobIds) {
			setJobIds(initialJobIds);
			return;
		}

		const poll = async () => {
			// Each cycle: nudge the extension to start syncing (fire-and-forget),
			// then check if phaseJobIds have appeared in the DB yet.
			// Handles cases where the initial trigger was missed (SW cold start,
			// timing race, token not yet available on first attempt).
			triggerExtensionSync();
			try {
				const result = await pollPhaseJobIds();
				if (result) {
					setJobIds(result);
					if (pollingRef.current) {
						clearInterval(pollingRef.current);
						pollingRef.current = null;
					}
				}
			} catch {
				// Polling failure is non-critical — will retry on next interval
			}
		};

		poll();
		pollingRef.current = setInterval(poll, POLL_INTERVAL_MS);

		return () => {
			if (pollingRef.current) {
				clearInterval(pollingRef.current);
				pollingRef.current = null;
			}
		};
	}, [initialJobIds]);

	return jobIds;
}

interface SyncingStepProps {
	phaseJobIds: PhaseJobIds | null;
}

export function SyncingStep({
	phaseJobIds: initialPhaseJobIds,
}: SyncingStepProps) {
	const theme = useTheme();
	const { goToStep } = useOnboardingNavigation();

	const phaseJobIds = usePolledPhaseJobIds(initialPhaseJobIds);

	const songs = useJobProgress(phaseJobIds?.liked_songs ?? null);
	const playlists = useJobProgress(phaseJobIds?.playlists ?? null);
	const tracks = useJobProgress(phaseJobIds?.playlist_tracks ?? null);

	const { percent, label, allComplete, isFailed, error, isDiscovering } =
		useMemo(() => {
			const phases = [
				{ state: songs, label: "Syncing songs..." },
				{ state: playlists, label: "Syncing playlists..." },
				{ state: tracks, label: "Syncing tracks..." },
			];

			// Check if we have any totals yet (librarySummary phase sends all totals at once)
			const hasAnyTotals =
				(songs.itemTotals.get("liked_songs") ?? 0) > 0 ||
				(playlists.itemTotals.get("playlists") ?? 0) > 0 ||
				(tracks.itemTotals.get("playlist_tracks") ?? 0) > 0;

			const completedCount = phases.filter(
				(p) => p.state.status === "completed",
			).length;
			const failed = phases.find((p) => p.state.status === "failed");
			const current = phases.find(
				(p) => p.state.status === "running" || p.state.status === "pending",
			);

			// Show "Discovering..." when no totals received yet
			const currentLabel = !hasAnyTotals
				? "Discovering your library..."
				: failed
					? "Sync failed"
					: (current?.label ?? "Complete!");

			const calculatedPercent = calculateCombinedProgress(
				songs,
				playlists,
				tracks,
			);
			const isComplete = completedCount === 3;

			return {
				percent: calculatedPercent,
				label: currentLabel,
				allComplete: isComplete,
				isFailed: !!failed,
				error: failed?.state.error ?? null,
				isDiscovering: !hasAnyTotals,
			};
		}, [
			songs.status,
			songs.items,
			songs.itemTotals,
			playlists.status,
			playlists.items,
			playlists.itemTotals,
			tracks.status,
			tracks.items,
			tracks.itemTotals,
			songs.error,
			playlists.error,
			tracks.error,
		]);

	// Extract counts and totals for stats
	// When a phase is complete (succeeded), show total as count to avoid stale values
	const phaseCounts = useMemo(() => {
		const songsItem = songs.items.get("liked_songs");
		const playlistsItem = playlists.items.get("playlists");
		const tracksItem = tracks.items.get("playlist_tracks");

		const songsTotal = songs.itemTotals.get("liked_songs") ?? 0;
		const playlistsTotal = playlists.itemTotals.get("playlists") ?? 0;
		const tracksTotal = tracks.itemTotals.get("playlist_tracks") ?? 0;

		return {
			songs: {
				count:
					songsItem?.status === "succeeded"
						? songsTotal
						: (songsItem?.count ?? 0),
				total: songsTotal,
			},
			playlists: {
				count:
					playlistsItem?.status === "succeeded"
						? playlistsTotal
						: (playlistsItem?.count ?? 0),
				total: playlistsTotal,
			},
			playlistTracks: {
				count:
					tracksItem?.status === "succeeded"
						? tracksTotal
						: (tracksItem?.count ?? 0),
				total: tracksTotal,
			},
		};
	}, [
		songs.items,
		songs.itemTotals,
		playlists.items,
		playlists.itemTotals,
		tracks.items,
		tracks.itemTotals,
	]);

	// Buffered progress - always one batch behind so we never stop moving
	const syncProgress = useSmoothProgress(percent, allComplete);

	// Event handler for auto-advance - reads latest values without re-triggering effect
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
			const timer = setTimeout(onSyncComplete, 1500); // 1.5 second delay to show final counts
			return () => clearTimeout(timer);
		}
	}, [allComplete]);

	// Waiting for extension to trigger sync — polling for phaseJobIds
	if (!phaseJobIds) {
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
					Waiting for
					<br />
					<em className="font-normal">Spotify</em>
				</h2>

				<div className="mt-12">
					<WaitingWaveform color={theme.textMuted} />
				</div>
			</div>
		);
	}

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
					<p>Counting your songs and playlists...</p>
				</div>
			) : (
				<div
					className="mt-8 space-y-1 text-sm"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					{phaseCounts.playlists.total > 0 && (
						<p>
							{phaseCounts.playlists.count.toLocaleString()}/
							{phaseCounts.playlists.total.toLocaleString()} playlists
						</p>
					)}
					{phaseCounts.playlistTracks.total > 0 && (
						<p>
							{phaseCounts.playlistTracks.count.toLocaleString()}/
							{phaseCounts.playlistTracks.total.toLocaleString()} playlist
							tracks
						</p>
					)}

					{phaseCounts.songs.total > 0 && (
						<p>
							{phaseCounts.songs.count.toLocaleString()}/
							{phaseCounts.songs.total.toLocaleString()} liked songs
						</p>
					)}
					<p className="mt-2">{label}</p>
				</div>
			)}
		</div>
	);
}
