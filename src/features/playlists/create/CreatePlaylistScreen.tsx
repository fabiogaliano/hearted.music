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
import { useSingleActivePlayback } from "@/features/playback/useSingleActivePlayback";
import type { BillingState } from "@/lib/domains/billing/state";
import {
	getBrowserTarget,
	getExtensionStoreUrl,
} from "@/lib/extension/browser-target";
import type { CreatePlaylistFromDraftInput } from "@/lib/extension/create-playlist-from-draft";
import { SpotifyReconnectLink } from "@/lib/extension/SpotifyReconnectLink";
import { getLikedSongIdsByArtist } from "@/lib/server/playlists.functions";
import { fonts } from "@/lib/theme/fonts";
import { FiltersConfig } from "./config/FiltersConfig";
import { GenreConfig } from "./config/GenreConfig";
import { IntentEditor } from "./config/IntentEditor";
import { CreateBar } from "./create-flow/CreateBar";
import { LibraryEmptyState } from "./create-flow/LibraryEmptyState";
import { NotEnoughSongsNote } from "./create-flow/NotEnoughSongsNote";
import { PartialState } from "./create-flow/PartialState";
import { SuccessState } from "./create-flow/SuccessState";
import { UnsyncedState } from "./create-flow/UnsyncedState";
import { intentEligibilityQueryOptions } from "./intentEligibility";
import { MaxSongsSlider } from "./MaxSongsSlider";
import { PreviewList } from "./preview/PreviewList";
import { SeedStage } from "./seed/SeedStage";
import type { PresetVM } from "./seedTypes";
import { SuggestionsTray } from "./suggestions/SuggestionsTray";
import { useCreatePlaylistDraft } from "./useCreatePlaylistDraft";
import { useCreatePlaylistFlow } from "./useCreatePlaylistFlow";
import { useSpotifyGate } from "./useSpotifyGate";

const MAX_NAME_LENGTH = 100;
const DEFAULT_NAME = "New playlist";

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
	const [name, setName] = useState(DEFAULT_NAME);
	const [showPaywall, setShowPaywall] = useState(false);

	// Beat 1 vs beat 2: null = the seed landing ("What are we making?"), set =
	// the studio. The seed carries the chosen preset/typed vibe into the draft.
	const [hasSeeded, setHasSeeded] = useState(false);

	// Proactively surface the reconnect/install affordance at page load so the
	// user knows about a disconnected Spotify session before attempting to create.
	// The gate keeps re-checking while unhealthy (focus/visibility + a manual
	// "Check again" in the prompts) so recovering in another tab isn't a dead end.
	const { gateState, recheck, reportGateFailure } = useSpotifyGate();

	// Owns the commit-flow lifecycle (submit → success/partial/created-unsynced,
	// gate-failure routing, isSubmitting). Declared before `playback` below
	// since it's keyed on flow.result.
	const flow = useCreatePlaylistFlow({ reportGateFailure });

	// Shared across the preview list AND the suggestions tray so only one
	// in-row Spotify preview plays at a time across the whole screen (U2).
	// resetKey: PreviewList and SuggestionsTray stay mounted regardless of
	// flow.result — only the footer swaps to SuccessState/PartialState/
	// UnsyncedState. Keying on flow.result?.status instead stops any in-flight
	// preview the moment a create result lands (and again on later status
	// transitions, e.g. a created-unsynced retry), rather than leaving an
	// iframe playing behind a footer that no longer matches it.
	const playback = useSingleActivePlayback(flow.result?.status ?? null);

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
	// from cache. The gate carries the criteria (for the seed stage's locked
	// treatment); the studio only needs `allowed`, collapsed here. Defaults to
	// locked so the teaser renders first-paint even if the pre-warm missed.
	const { data: intentGate } = useQuery(intentEligibilityQueryOptions());
	const isIntentEligible = intentGate?.allowed ?? false;

	// Commit a seed → enter the studio. A template preset names the playlist and
	// pre-fills its structured config; "own words" seeds the intent (only if the
	// gate allows it — templates are structured and never carry intent); "from
	// scratch" just enters. Genres, match-filters (decade → releaseYear, window →
	// likedAt), and intent flow into the live draft so the preview reflects the
	// seed immediately. An artist seed carries no config filter — instead its name
	// resolves to the account's liked songs by that artist, pinned so the preview
	// opens on them. The lookup is fire-and-forget after entering the studio: it
	// only shifts pins, so a slow/failed resolve just delays (or skips) the pins
	// rather than blocking the studio.
	const handleSeed = useCallback(
		(preset: PresetVM | null, intentText: string) => {
			if (preset?.label) setName(preset.label);
			if (preset && preset.genrePills.length > 0) {
				draft.setGenrePills(preset.genrePills);
			}
			if (preset?.matchFilters) {
				draft.setMatchFilters(preset.matchFilters);
			}
			const nextIntent = intentText || undefined;
			if (isIntentEligible && nextIntent) draft.setIntent(nextIntent);
			setHasSeeded(true);
			if (preset?.pinArtist) {
				void getLikedSongIdsByArtist({ data: { artist: preset.pinArtist } })
					.then(({ songIds }) => draft.pinSongs(songIds))
					.catch(() => {
						// Non-fatal: the studio is already open on the default preview;
						// a failed pin resolve just means no artist songs are pre-pinned.
					});
			}
		},
		[
			draft.setGenrePills,
			draft.setMatchFilters,
			draft.setIntent,
			draft.pinSongs,
			isIntentEligible,
		],
	);

	// When the create bar unmounts and the result state mounts (success or
	// partial), keyboard focus would otherwise fall to <body>. Move it into
	// the result region so AT users land on the status message immediately.
	const resultRegionRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (flow.result !== null) {
			resultRegionRef.current?.focus();
		}
	}, [flow.result]);

	// Payload assembly lives here (not in CreateBar, which is presentational):
	// songIds come from the previewed draft, config from the DEBOUNCED
	// (committed) config — never the live config — so a submit can't persist an
	// edited config against songs scored under the previous one.
	const handleSubmit = useCallback(() => {
		const submitInput: CreatePlaylistFromDraftInput = {
			name: name.trim(),
			songIds: draft.tracklist.map((s) => s.id),
			genrePills: draft.committedConfig.genrePills,
			matchFilters: draft.committedConfig.matchFilters,
			intentApplied: draft.intentApplied,
			intent:
				draft.intentApplied && draft.committedConfig.intent
					? draft.committedConfig.intent
					: null,
		};
		void flow.submit(submitInput);
	}, [
		name,
		draft.tracklist,
		draft.committedConfig,
		draft.intentApplied,
		flow.submit,
	]);

	// Not-enough note: eligible but fewer than the slider max.
	const showNotEnoughNote =
		draft.totalEligible > 0 &&
		draft.totalEligible < draft.config.maxSongs &&
		!draft.isLoading;

	// Warming: no eligible songs, still loading (backfill just kicked off).
	const isWarming = draft.totalEligible === 0 && draft.isLoading;

	// Beat 1: the seed landing owns the whole screen until a seed is chosen. The
	// locked intent field reuses the studio's paywall — same UpgradeDialog, same
	// showPaywall state — so "unlock" is one consistent surface across the flow.
	if (!hasSeeded) {
		return (
			<>
				<SeedStage onSeed={handleSeed} onUnlock={() => setShowPaywall(true)} />
				{showPaywall && (
					<UpgradeDialog
						billingState={billingState}
						onClose={() => setShowPaywall(false)}
					/>
				)}
			</>
		);
	}

	return (
		<div className="mx-auto max-w-[1180px] pb-24">
			<header className="mb-10 flex items-start justify-between gap-6">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<button
						type="button"
						onClick={() => void navigate({ to: "/playlists" })}
						className="theme-text-muted -ml-0.5 mb-3 inline-flex w-fit cursor-pointer items-center gap-1.5 text-[11px] tracking-widest uppercase transition-opacity duration-150 hover:opacity-70"
						style={{ fontFamily: fonts.body }}
					>
						<ArrowLeftIcon size={11} weight="regular" aria-hidden />
						Playlists
					</button>
					{/* The name is the page title; the visible control is an input, so the
					    heading in the a11y tree is a sibling sr-only h1. */}
					<h1 className="sr-only">{name.trim() || DEFAULT_NAME}</h1>
					<input
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_LENGTH))}
						maxLength={MAX_NAME_LENGTH}
						placeholder="Name this playlist…"
						aria-label="Playlist name"
						className="theme-text text-page-title w-full bg-transparent leading-[0.95] font-extralight tracking-tight outline-none focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)]"
						style={{ fontFamily: fonts.display }}
					/>
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

			<div className="grid grid-cols-1 gap-10 lg:grid-cols-[300px_1fr] lg:items-start">
				<aside className="flex flex-col gap-7 lg:sticky lg:top-8">
					<IntentEditor
						isEligible={isIntentEligible}
						value={draft.config.intent}
						onChange={draft.setIntent}
						onOpenPaywall={() => setShowPaywall(true)}
					/>
					<GenreConfig
						accountId={accountId}
						value={draft.config.genrePills}
						onChange={draft.setGenrePills}
					/>
					<FiltersConfig
						accountId={accountId}
						value={draft.config.matchFilters}
						onChange={draft.setMatchFilters}
					/>
					<MaxSongsSlider
						value={draft.config.maxSongs}
						onChange={draft.setMaxSongs}
					/>
				</aside>

				<main>
					<section className="mb-10">
						<div className="mb-6 flex items-center justify-between gap-4 px-1">
							<div className="flex items-center gap-4">
								<h2
									className="theme-text-muted m-0 text-xs font-normal tracking-[0.2em] uppercase"
									style={{ fontFamily: fonts.body }}
								>
									Preview
								</h2>
								<div className="theme-border-color h-px w-20 border-t" />
								{draft.totalEligible > 0 && (
									<span
										className="theme-text-muted text-xs tabular-nums"
										style={{ fontFamily: fonts.body }}
									>
										{draft.tracklist.length} of {draft.totalEligible} eligible
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
								songs={draft.tracklist}
								isLoading={draft.isLoading}
								onRemoveSong={draft.removeSong}
								onRestoreSong={draft.restoreSong}
								newSongIds={newSongIds}
								playback={playback}
							/>
						)}

						{showNotEnoughNote && (
							<div className="mt-3">
								<NotEnoughSongsNote totalEligible={draft.totalEligible} />
							</div>
						)}
					</section>

					<section>
						<div className="mb-6 flex items-center gap-4 px-1">
							<h2
								className="theme-text-muted m-0 text-xs font-normal tracking-[0.2em] uppercase"
								style={{ fontFamily: fonts.body }}
							>
								Suggested to add
							</h2>
							<div className="theme-border-color h-px flex-1 border-t" />
						</div>
						<SuggestionsTray
							suggestions={draft.suggestions}
							onAddSong={handleAddSong}
							onDismissSong={handleDismissSuggestion}
							onRefresh={draft.refreshSuggestions}
							playback={playback}
						/>
					</section>
				</main>
			</div>

			{/* Create section — flat bordered footer anchored below the studio grid */}
			<div className="theme-border-color mt-10 border">
				<div className="theme-border-color border-b px-6 py-3">
					<span
						className="theme-text-muted text-[11px] tracking-[0.2em] uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Create
					</span>
				</div>

				{flow.result?.status === "success" ? (
					// tabIndex={-1} lets the ref.focus() land here without putting the
					// container itself in the tab order — focus immediately moves to the
					// first interactive element (the Spotify link or Done button) via AT.
					<div ref={resultRegionRef} tabIndex={-1} className="outline-none">
						<SuccessState
							playlistName={flow.result.playlistName}
							spotifyId={flow.result.spotifyId}
							playlistId={flow.result.playlistId}
						/>
					</div>
				) : flow.result?.status === "partial" ? (
					<div ref={resultRegionRef} tabIndex={-1} className="outline-none">
						<PartialState
							spotifyId={flow.result.spotifyId}
							playlistId={flow.result.playlistId}
							failedTrackCount={flow.result.failedTrackCount}
						/>
					</div>
				) : flow.result?.status === "created-unsynced" ? (
					<div ref={resultRegionRef} tabIndex={-1} className="outline-none">
						<UnsyncedState
							spotifyId={flow.result.spotifyId}
							isRetrying={flow.isRetryingUnsynced}
							onRetry={() => void flow.retryUnsynced()}
						/>
					</div>
				) : (
					<CreateBar
						name={name}
						songIds={draft.tracklist.map((s) => s.id)}
						isPreviewStale={draft.isConfigStale}
						isSubmitting={flow.isSubmitting}
						gateState={gateState}
						recheck={recheck}
						onSubmit={handleSubmit}
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
