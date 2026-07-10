/**
 * CreatePlaylistScreen — the page shell for /playlists/new.
 *
 * Lays out the four regions of the creation flow with intentional
 * hearted-style spacing and typography. The create bar anchors the bottom
 * with a flat bordered footer that maps the result to inline success,
 * partial, reconnect, or extension-unavailable states.
 *
 * The screen is deliberately calm — no loaders in the shell itself; the
 * useCreatePlaylistDraft hook drives per-region loading state.
 */

import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { UpgradeDialog } from "@/features/billing/components/UpgradeDialog";
import type { BillingState } from "@/lib/domains/billing/state";
import {
	getBrowserTarget,
	getExtensionStoreUrl,
} from "@/lib/extension/browser-target";
import type {
	CreatePlaylistFromDraftInput,
	CreatePlaylistFromDraftResult,
} from "@/lib/extension/create-playlist-from-draft";
import { resumePlaylistCreateFromDraft } from "@/lib/extension/create-playlist-from-draft";
import { SpotifyReconnectLink } from "@/lib/extension/SpotifyReconnectLink";
import { fonts } from "@/lib/theme/fonts";
import { ConfigSurface } from "./config/ConfigSurface";
import { CreateBar } from "./create-flow/CreateBar";
import { LibraryEmptyState } from "./create-flow/LibraryEmptyState";
import { NotEnoughSongsNote } from "./create-flow/NotEnoughSongsNote";
import { PartialState } from "./create-flow/PartialState";
import { SuccessState } from "./create-flow/SuccessState";
import { UnsyncedState } from "./create-flow/UnsyncedState";
import { intentEligibilityQueryOptions } from "./intentEligibility";
import { PreviewList } from "./preview/PreviewList";
import { SuggestionsTray } from "./suggestions/SuggestionsTray";
import { useCreatePlaylistDraft } from "./useCreatePlaylistDraft";
import { useSpotifyGate } from "./useSpotifyGate";

/**
 * Result state held by the screen after the orchestrator returns.
 * null = not yet attempted.
 */
type FlowResult =
	| null
	| {
			status: "success";
			playlistName: string;
			spotifyId: string;
			playlistId: string;
	  }
	| {
			status: "partial";
			spotifyId: string;
			playlistId?: string;
			failedTrackCount: number;
	  }
	| { status: "created-unsynced"; spotifyId: string; playlistUri: string };

interface CreatePlaylistScreenProps {
	accountId: string;
	billingState: BillingState;
}

export function CreatePlaylistScreen({
	accountId,
	billingState,
}: CreatePlaylistScreenProps) {
	const navigate = useNavigate();
	const draft = useCreatePlaylistDraft();
	const [showPaywall, setShowPaywall] = useState(false);
	const [flowResult, setFlowResult] = useState<FlowResult>(null);

	// Track IDs of songs added to the preview this session so PreviewList can
	// briefly highlight them on entry. Cleared after the pulse animation plays out
	// (1.5s covers the full opacity+y animation). Timers are cleaned up on unmount
	// to avoid setState-after-unmount leaks.
	const [newSongIds, setNewSongIds] = useState<ReadonlySet<string>>(new Set());
	const newSongTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
		new Map(),
	);

	useEffect(() => {
		const timeouts = newSongTimeoutsRef.current;
		return () => {
			for (const tid of timeouts.values()) clearTimeout(tid);
			timeouts.clear();
		};
	}, []);

	const handleAddSong = useCallback(
		(id: string) => {
			draft.addSong(id);
			setNewSongIds((prev) => new Set([...prev, id]));
			// Clear the highlight after the pulse animation completes
			const existing = newSongTimeoutsRef.current.get(id);
			if (existing) clearTimeout(existing);
			const tid = setTimeout(() => {
				setNewSongIds((prev) => {
					const next = new Set(prev);
					next.delete(id);
					return next;
				});
				newSongTimeoutsRef.current.delete(id);
			}, 1500);
			newSongTimeoutsRef.current.set(id, tid);
		},
		[draft.addSong],
	);

	// Undo mirrors PreviewList's remove-undo: dismissing a suggestion and
	// removing a preview song are both exclusions under the hood, so a user who
	// dismisses by mistake gets the same one-tap recovery either way. restoreSong
	// un-excludes without force-pinning, so the song only reappears in the tray
	// if the current ranking would still put it there.
	const handleDismissSuggestion = useCallback(
		(id: string) => {
			const song = draft.suggestions.find((s) => s.id === id);
			draft.dismissSuggestion(id);
			toast(`Dismissed ${song?.name ?? "song"}`, {
				action: {
					label: "Undo",
					onClick: () => draft.restoreSong(id),
				},
			});
		},
		[draft.suggestions, draft.dismissSuggestion, draft.restoreSong],
	);

	// Intent eligibility was seeded by the route loader; this read is synchronous
	// from cache. Defaults to false (locked) so the teaser renders first-paint
	// even if the loader somehow didn't pre-warm (defensive).
	const { data: isIntentEligible = false } = useQuery(
		intentEligibilityQueryOptions(),
	);

	// Proactively surface the reconnect/install affordance at page load so the
	// user knows about a disconnected Spotify session before attempting to create.
	// The gate keeps re-checking while unhealthy (focus/visibility + a manual
	// "Check again" in the prompts) so recovering in another tab isn't a dead end.
	const { gateState, recheck, reportGateFailure } = useSpotifyGate();

	// Holds the name committed just before the orchestrator runs. A ref avoids
	// the stale-closure risk: handleCreateResult fires after an async boundary,
	// so reading a ref is safer than relying on the closure-captured state value.
	const submittedNameRef = useRef<string>("");

	// Snapshot of the exact input submitted to the orchestrator. A "created-unsynced"
	// retry must resume against these original draft settings (genre pills, filters,
	// intent, songIds) even if the live config was edited after the failed attempt,
	// so the draft isn't silently lost.
	const submittedInputRef = useRef<CreatePlaylistFromDraftInput | null>(null);
	const [isRetryingUnsynced, setIsRetryingUnsynced] = useState(false);

	// When the create bar unmounts and the result state mounts (success or
	// partial), keyboard focus would otherwise fall to <body>. Move it into
	// the result region so AT users land on the status message immediately.
	const resultRegionRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (flowResult !== null) {
			resultRegionRef.current?.focus();
		}
	}, [flowResult]);
	const onNameCommit = useCallback((name: string) => {
		submittedNameRef.current = name;
	}, []);
	const onSubmitInput = useCallback((input: CreatePlaylistFromDraftInput) => {
		submittedInputRef.current = input;
	}, []);

	function handleCreateResult(result: CreatePlaylistFromDraftResult) {
		if (result.status === "success") {
			setFlowResult({
				status: "success",
				playlistName: submittedNameRef.current,
				spotifyId: result.spotifyId,
				playlistId: result.playlistId,
			});
		} else if (result.status === "partial") {
			setFlowResult({
				status: "partial",
				spotifyId: result.spotifyId,
				playlistId: result.playlistId,
				failedTrackCount: result.failedTrackCount,
			});
		} else if (result.status === "created-unsynced") {
			// Spotify has the playlist but the local row never landed. Hold the
			// URI/ID so the retry can resume against the same playlist.
			setFlowResult({
				status: "created-unsynced",
				spotifyId: result.spotifyId,
				playlistUri: result.playlistUri,
			});
		} else if (result.status === "reconnect-required") {
			// The gate was "ok" when submit started but auth expired mid-flight.
			// Force the gate so the create section swaps to the reconnect affordance.
			reportGateFailure("reconnect-required");
		} else if (result.status === "extension-unavailable") {
			reportGateFailure("extension-unavailable");
		}
		// error: handled in CreateBar via toast; no flow result change needed.
	}

	// Resume a "created-unsynced" create: re-drive acknowledge + config + track
	// adds against the EXISTING playlist (never a fresh create, so no duplicate).
	async function handleRetryUnsynced(playlistUri: string, spotifyId: string) {
		const input = submittedInputRef.current;
		if (!input) return;
		setIsRetryingUnsynced(true);
		try {
			const result = await resumePlaylistCreateFromDraft(
				input,
				playlistUri,
				spotifyId,
			);
			handleCreateResult(result);
		} catch {
			toast.error("Something went sideways. Let's try that again.");
		} finally {
			setIsRetryingUnsynced(false);
		}
	}

	// Not-enough note: eligible but fewer than the slider max.
	const showNotEnoughNote =
		draft.totalEligible > 0 &&
		draft.totalEligible < draft.config.maxSongs &&
		!draft.isLoading;

	// Warming: no eligible songs, still loading (backfill just kicked off).
	const isWarming = draft.totalEligible === 0 && draft.isLoading;

	return (
		<div className="mx-auto max-w-[1180px] pb-24">
			<header className="mb-10 flex items-start justify-between gap-6">
				<div className="flex flex-col gap-1">
					<button
						type="button"
						onClick={() => void navigate({ to: "/playlists" })}
						className="theme-text-muted -ml-0.5 mb-3 inline-flex cursor-pointer items-center gap-1.5 text-[11px] tracking-widest uppercase transition-opacity duration-150 hover:opacity-70"
						style={{ fontFamily: fonts.body }}
					>
						<ArrowLeftIcon size={11} weight="regular" aria-hidden />
						Playlists
					</button>
					<h1
						className="theme-text text-page-title leading-[0.95] font-extralight tracking-tight text-balance"
						style={{ fontFamily: fonts.display }}
					>
						New playlist
					</h1>
				</div>

				{gateState === "extension-unavailable" && (
					<div className="flex items-center gap-3 pt-1">
						<span
							className="theme-text-muted text-xs"
							style={{ fontFamily: fonts.body }}
						>
							Extension not detected
						</span>
						<a
							href={getExtensionStoreUrl(getBrowserTarget())}
							target="_blank"
							rel="noopener noreferrer"
							className="hover-border-brighten inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs tracking-widest uppercase active:scale-[0.98]"
							style={{ fontFamily: fonts.body }}
						>
							Install extension
							<span className="text-xs" style={{ opacity: 0.45 }}>
								↗
							</span>
						</a>
					</div>
				)}

				{gateState === "reconnect-required" && (
					<div className="flex items-center gap-3 pt-1">
						<span
							className="theme-text-muted text-xs"
							style={{ fontFamily: fonts.body }}
						>
							Spotify disconnected
						</span>
						<SpotifyReconnectLink />
					</div>
				)}
			</header>

			<section className="mb-10">
				<div className="mb-6 flex items-center gap-4 px-1">
					<span
						className="theme-text-muted text-xs tracking-[0.2em] uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Configure
					</span>
					<div className="theme-border-color h-px flex-1 border-t" />
				</div>

				<ConfigSurface
					accountId={accountId}
					isIntentEligible={isIntentEligible}
					intent={draft.config.intent}
					genrePills={draft.config.genrePills}
					matchFilters={draft.config.matchFilters}
					maxSongs={draft.config.maxSongs}
					onIntentChange={draft.setIntent}
					onGenrePillsChange={draft.setGenrePills}
					onMatchFiltersChange={draft.setMatchFilters}
					onMaxSongsChange={draft.setMaxSongs}
					onOpenPaywall={() => setShowPaywall(true)}
				/>
			</section>

			<section className="mb-10">
				<div className="mb-6 flex items-center justify-between gap-4 px-1">
					<div className="flex items-center gap-4">
						<span
							className="theme-text-muted text-xs tracking-[0.2em] uppercase"
							style={{ fontFamily: fonts.body }}
						>
							Preview
						</span>
						<div className="theme-border-color h-px w-20 border-t" />
						{draft.totalEligible > 0 && (
							<span
								className="theme-text-muted text-xs tabular-nums"
								style={{ fontFamily: fonts.body }}
							>
								{draft.preview.length} of {draft.totalEligible} eligible
							</span>
						)}
					</div>
					{draft.isLoading && (
						<span
							className="theme-text-muted text-[11px] tracking-widest uppercase"
							style={{ fontFamily: fonts.body }}
						>
							Updating…
						</span>
					)}
				</div>

				{draft.totalEligible === 0 && !draft.isLoading ? (
					<LibraryEmptyState isWarming={false} />
				) : isWarming ? (
					<LibraryEmptyState isWarming={true} />
				) : (
					<PreviewList
						songs={draft.preview}
						isLoading={draft.isLoading}
						onRemoveSong={draft.removeSong}
						onRestoreSong={draft.restoreSong}
						newSongIds={newSongIds}
					/>
				)}

				{showNotEnoughNote && (
					<div className="mt-3">
						<NotEnoughSongsNote totalEligible={draft.totalEligible} />
					</div>
				)}
			</section>

			<section className="mb-10">
				<div className="mb-6 flex items-center gap-4 px-1">
					<span
						className="theme-text-muted text-xs tracking-[0.2em] uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Suggested to add
					</span>
					<div className="theme-border-color h-px flex-1 border-t" />
				</div>
				<SuggestionsTray
					suggestions={draft.suggestions}
					onAddSong={handleAddSong}
					onDismissSong={handleDismissSuggestion}
					onRefresh={draft.refreshSuggestions}
				/>
			</section>

			{/* Create section — flat bordered footer anchored below the suggestions tray */}
			<div className="theme-border-color border border-t-0">
				<div className="theme-border-color border-b px-6 py-3">
					<span
						className="theme-text-muted text-[11px] tracking-[0.2em] uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Create
					</span>
				</div>

				{flowResult?.status === "success" ? (
					// tabIndex={-1} lets the ref.focus() land here without putting the
					// container itself in the tab order — focus immediately moves to the
					// first interactive element (the Spotify link or Done button) via AT.
					<div ref={resultRegionRef} tabIndex={-1} className="outline-none">
						<SuccessState
							playlistName={flowResult.playlistName}
							spotifyId={flowResult.spotifyId}
							playlistId={flowResult.playlistId}
						/>
					</div>
				) : flowResult?.status === "partial" ? (
					<div ref={resultRegionRef} tabIndex={-1} className="outline-none">
						<PartialState
							spotifyId={flowResult.spotifyId}
							playlistId={flowResult.playlistId}
							failedTrackCount={flowResult.failedTrackCount}
						/>
					</div>
				) : flowResult?.status === "created-unsynced" ? (
					<div ref={resultRegionRef} tabIndex={-1} className="outline-none">
						<UnsyncedState
							spotifyId={flowResult.spotifyId}
							isRetrying={isRetryingUnsynced}
							onRetry={() =>
								void handleRetryUnsynced(
									flowResult.playlistUri,
									flowResult.spotifyId,
								)
							}
						/>
					</div>
				) : (
					<CreateBar
						songIds={draft.preview.map((s) => s.id)}
						genrePills={draft.committedConfig.genrePills}
						matchFilters={draft.committedConfig.matchFilters}
						intentApplied={draft.intentApplied}
						intent={draft.committedConfig.intent ?? null}
						isPreviewStale={draft.isConfigStale}
						gateState={gateState}
						recheck={recheck}
						onNameCommit={onNameCommit}
						onSubmitInput={onSubmitInput}
						onResult={handleCreateResult}
					/>
				)}
			</div>

			{showPaywall && (
				<UpgradeDialog
					billingState={billingState}
					onClose={() => setShowPaywall(false)}
				/>
			)}
		</div>
	);
}
