/**
 * Syncing step - shows real-time progress from 3 separate phase jobs.
 * Auto-advances to flag-playlists on completion.
 */

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { fonts } from "@/lib/theme/fonts";
import { type ThemeConfig } from "@/lib/theme/types";
import { useJobProgress, type JobProgressState } from "@/lib/hooks/useJobProgress";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";
import { startSync } from "@/lib/server/onboarding.server";
import type { PhaseJobIds } from "@/lib/jobs/progress/types";

// ============================================================================
// Smooth Progress Hook (Velocity-Based)
// ============================================================================

/**
 * Velocity-based smooth progress with damping.
 *
 * Instead of calculating "where should progress BE" (which causes jumps when
 * estimation changes), we calculate "how fast should progress MOVE" and change
 * that velocity gradually.
 *
 * Key principles:
 * - MIN_VELOCITY ensures progress NEVER stops (no pauses)
 * - MAX_VELOCITY ensures progress NEVER bursts (no jumps)
 * - Velocity smoothing means changes happen gradually over ~1 second
 * - Ceiling prevents getting too far ahead of actual progress
 *
 * @param target - The actual progress from batch updates (0-100)
 * @param isComplete - Whether sync has finished
 */
function useSmoothProgress(target: number, isComplete: boolean): number {
	// Simple approach: steady velocity with very gradual adjustments
	const BASE_VELOCITY = 0.033; // ~2%/sec - steady pace for ~50s total
	const SOFT_CEILING = 5; // Start slowing when this far ahead
	const HARD_CEILING = 8; // Never exceed this far ahead
	const CRAWL_VELOCITY = 0.01; // ~0.6%/sec when at ceiling

	const [display, setDisplay] = useState(0);
	const displayRef = useRef(0);
	const velocityRef = useRef(BASE_VELOCITY);
	const animationRef = useRef<number | null>(null);

	// Refs for tracking
	const targetRef = useRef(target);
	const isCompleteRef = useRef(isComplete);

	// Update refs when props change
	useEffect(() => {
		targetRef.current = target;
	}, [target]);

	useEffect(() => {
		isCompleteRef.current = isComplete;
	}, [isComplete]);

	// Animation loop
	useEffect(() => {
		const animate = () => {
			const prev = displayRef.current;
			const actualTarget = targetRef.current;
			const complete = isCompleteRef.current;

			// Done - stop animation
			if (prev >= 100) {
				displayRef.current = 100;
				setDisplay(100);
				return;
			}

			const gap = actualTarget - prev;

			// Very gentle velocity adjustments (98/2 blend - almost imperceptible)
			let targetVelocity: number;
			if (complete) {
				targetVelocity = 0.2; // Finish smoothly
			} else if (gap > 15) {
				// Very far behind - slightly faster
				targetVelocity = BASE_VELOCITY * 1.5;
			} else if (gap > 5) {
				// Behind - bit faster
				targetVelocity = BASE_VELOCITY * 1.2;
			} else if (gap < -2) {
				// Ahead - slower
				targetVelocity = BASE_VELOCITY * 0.7;
			} else {
				// On track
				targetVelocity = BASE_VELOCITY;
			}

			// Ultra-smooth velocity changes (98/2 blend)
			velocityRef.current = velocityRef.current * 0.98 + targetVelocity * 0.02;

			// Calculate ceiling (never reach 100% until complete)
			const ceiling = complete ? 100 : Math.min(actualTarget + HARD_CEILING, 99);

			let newDisplay: number;

			if (prev >= actualTarget + SOFT_CEILING) {
				// At soft ceiling - crawl slowly
				newDisplay = prev + CRAWL_VELOCITY;
			} else {
				// Normal steady movement
				newDisplay = prev + velocityRef.current;
			}

			// Apply ceiling
			newDisplay = Math.min(newDisplay, ceiling);

			// Never go backwards
			newDisplay = Math.max(newDisplay, prev);

			displayRef.current = newDisplay;

			// Update React state
			if (Math.abs(newDisplay - prev) > 0.005) {
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

// ============================================================================
// Progress Calculation
// ============================================================================

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

	// Get totals and counts for each phase
	const phaseData = phases.map(({ state, itemId }) => {
		const total = state.itemTotals.get(itemId) ?? 0;
		const count = state.items.get(itemId)?.count ?? 0;
		return { state, total, count };
	});

	const grandTotal = phaseData.reduce((sum, p) => sum + p.total, 0);

	// No data yet - return 0
	if (grandTotal === 0) return 0;

	// Check if all totals are known (use dynamic weights only then)
	const allTotalsKnown = phaseData.every((p) => p.total > 0);

	// Calculate weighted progress
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

interface SyncingStepProps {
	theme: ThemeConfig;
	phaseJobIds: PhaseJobIds | null;
}

export function SyncingStep({ theme, phaseJobIds }: SyncingStepProps) {
	const { goToStep } = useOnboardingNavigation();
	const syncStartedRef = useRef(false);

	// Subscribe to all 3 jobs
	const songs = useJobProgress(phaseJobIds?.liked_songs ?? null);
	const playlists = useJobProgress(phaseJobIds?.playlists ?? null);
	const tracks = useJobProgress(phaseJobIds?.playlist_tracks ?? null);

	// Dynamic weighted progress based on actual item counts
	const { percent, label, allComplete, isFailed, error, isDiscovering } = useMemo(() => {
		const phases = [
			{ state: songs, label: "Syncing songs..." },
			{ state: playlists, label: "Syncing playlists..." },
			{ state: tracks, label: "Syncing tracks..." },
		];

		// Check if we have any totals yet (discovery phase sends all totals at once)
		const hasAnyTotals =
			(songs.itemTotals.get("liked_songs") ?? 0) > 0 ||
			(playlists.itemTotals.get("playlists") ?? 0) > 0 ||
			(tracks.itemTotals.get("playlist_tracks") ?? 0) > 0;

		const completedCount = phases.filter((p) => p.state.status === "completed")
			.length;
		const failed = phases.find((p) => p.state.status === "failed");
		const current = phases.find(
			(p) => p.state.status === "running" || p.state.status === "pending",
		);

		// Show "Discovering..." when no totals received yet
		const currentLabel = !hasAnyTotals
			? "Discovering your library..."
			: failed
				? "Sync failed"
				: current?.label ?? "Complete!";

		return {
			percent: calculateCombinedProgress(songs, playlists, tracks),
			label: currentLabel,
			allComplete: completedCount === 3,
			isFailed: !!failed,
			error: failed?.state.error ?? null,
			isDiscovering: !hasAnyTotals,
		};
	}, [songs.status, songs.items, songs.itemTotals, playlists.status, playlists.items, playlists.itemTotals, tracks.status, tracks.items, tracks.itemTotals, songs.error, playlists.error, tracks.error]);

	// Extract counts and totals for stats
	// When a phase is complete (succeeded), show total as count to avoid stale values
	const phaseCounts = useMemo(
		() => {
			const songsItem = songs.items.get("liked_songs");
			const playlistsItem = playlists.items.get("playlists");
			const tracksItem = tracks.items.get("playlist_tracks");

			const songsTotal = songs.itemTotals.get("liked_songs") ?? 0;
			const playlistsTotal = playlists.itemTotals.get("playlists") ?? 0;
			const tracksTotal = tracks.itemTotals.get("playlist_tracks") ?? 0;

			return {
				songs: {
					count: songsItem?.status === "succeeded" ? songsTotal : (songsItem?.count ?? 0),
					total: songsTotal,
				},
				playlists: {
					count: playlistsItem?.status === "succeeded" ? playlistsTotal : (playlistsItem?.count ?? 0),
					total: playlistsTotal,
				},
				playlistTracks: {
					count: tracksItem?.status === "succeeded" ? tracksTotal : (tracksItem?.count ?? 0),
					total: tracksTotal,
				},
			};
		},
		[songs.items, songs.itemTotals, playlists.items, playlists.itemTotals, tracks.items, tracks.itemTotals],
	);

	// Buffered progress - always one batch behind so we never stop moving
	const syncProgress = useSmoothProgress(percent, allComplete);

	// Start sync on mount
	useEffect(() => {
		if (!phaseJobIds || syncStartedRef.current) return;
		syncStartedRef.current = true;

		startSync({ data: { phaseJobIds } }).catch((err) => {
			console.error("Failed to start sync:", err);
			toast.error("Failed to start sync. Please try again.");
		});
	}, [phaseJobIds]);

	// Event handler for auto-advance - reads latest values without re-triggering effect
	const onSyncComplete = useEffectEvent(() => {
		goToStep("flag-playlists", {
			syncStats: {
				songs: phaseCounts.songs.count,
				playlists: phaseCounts.playlists.count,
			},
		});
	});

	// Auto-advance on complete
	useEffect(() => {
		if (allComplete) {
			const timer = setTimeout(onSyncComplete, 1500); // 1.5 second delay to show final counts
			return () => clearTimeout(timer);
		}
	}, [allComplete]);

	// Handle missing phaseJobIds (refresh during sync)
	if (!phaseJobIds) {
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
					Sync interrupted
				</h2>

				<p
					className="mt-6 text-lg font-light"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Please start over to sync your library.
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
				Reading your
				<br />
				<em className="font-normal">library</em>
			</h2>

			{/* Large percentage display */}
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

			{/* Progressive status messages */}
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
						<p>{phaseCounts.playlists.count.toLocaleString()}/{phaseCounts.playlists.total.toLocaleString()} playlists</p>
					)}
					{phaseCounts.playlistTracks.total > 0 && (
						<p>{phaseCounts.playlistTracks.count.toLocaleString()}/{phaseCounts.playlistTracks.total.toLocaleString()} playlist tracks</p>
					)}

					{phaseCounts.songs.total > 0 && (
						<p>{phaseCounts.songs.count.toLocaleString()}/{phaseCounts.songs.total.toLocaleString()} liked songs</p>
					)}
					<p className="mt-2">{label}</p>
				</div>
			)}

			{/* Skip button for dev */}
			{import.meta.env.DEV && (
				<button
					type="button"
					onClick={async () => {
						try {
							await goToStep("flag-playlists", { syncStats: { songs: 0, playlists: 0 } });
						} catch (error) {
							console.error("Failed to skip:", error);
						}
					}}
					className="mt-8 text-sm underline"
					style={{ color: theme.textMuted }}
				>
					Skip (dev)
				</button>
			)}
		</div>
	);
}
