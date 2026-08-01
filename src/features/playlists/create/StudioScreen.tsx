/**
 * StudioScreen — beat 2 of creation, the route body for /playlists/new/studio.
 *
 * Lays out the four regions of the creation flow with intentional
 * hearted-style spacing and typography. The create bar anchors the bottom
 * with a flat bordered footer that maps the result to inline success,
 * partial, reconnect, or extension-unavailable states.
 *
 * The screen is deliberately calm — no loaders in the shell itself; the
 * useCreatePlaylistDraft hook drives per-region loading state.
 *
 * The seed arrives in router history state (studioSeed.ts): name, genre,
 * filters, intent, and an optional pinned artist are read ONCE to initialize
 * the draft. Re-seeding is a fresh navigation from the entrance, so a fresh
 * mount — never a mid-life mutation of this screen's state.
 */

import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { UpgradeDialog } from "@/features/billing/components/UpgradeDialog";
import { useSingleActivePlayback } from "@/features/playback/useSingleActivePlayback";
import type { BillingState } from "@/lib/domains/billing/state";
import { fonts } from "@/lib/theme/fonts";
import { ArtistConfig } from "./config/ArtistConfig";
import { FiltersConfig } from "./config/FiltersConfig";
import { GenreConfig } from "./config/GenreConfig";
import { IntentEditor } from "./config/IntentEditor";
import { intentEligibilityQueryOptions } from "./intentEligibility";
import { LibraryEmptyState } from "./LibraryEmptyState";
import { MaxSongsSlider } from "./MaxSongsSlider";
import { NotEnoughSongsNote } from "./NotEnoughSongsNote";
import { PreviewList } from "./preview/PreviewList";
import { PreviewListSkeleton } from "./preview/PreviewListSkeleton";
import { CreateBar } from "./publish/CreateBar";
import { PublishResultRegion } from "./publish/PublishResultRegion";
import { getStudioPreviewState } from "./studioPreviewState";
import { type StudioSeed, studioSeedToDraftInit } from "./studioSeed";
import { buildStudioSubmitInput } from "./studioSubmitInput";
import { SuggestionsTray } from "./suggestions/SuggestionsTray";
import { useCreatePlaylistDraft } from "./useCreatePlaylistDraft";
import { usePublishPlaylist } from "./usePublishPlaylist";
import { useSongAddHighlight } from "./useSongAddHighlight";
import { useSpotifyGate } from "./useSpotifyGate";

const MAX_NAME_LENGTH = 100;
const DEFAULT_NAME = "";

interface StudioScreenProps {
	accountId: string;
	billingState: BillingState;
	seed: StudioSeed;
	/** account.spotify_id — the Spotify identity hearted has linked, used to
	 * detect a mismatched extension account (see useSpotifyGate.ts). null
	 * pre-link (before the account's first sync). */
	linkedSpotifyId: string | null;
	/** account.display_name — sharpens CreateBar's account-mismatch prompt
	 * from "the wrong account" to "not <name>" (same field Dashboard.tsx
	 * threads for its own mismatch banner). Optional because
	 * AccountMismatchPrompt already renders sensible copy for null. */
	accountDisplayName?: string | null;
}

export function StudioScreen({
	accountId,
	billingState,
	seed,
	linkedSpotifyId,
	accountDisplayName = null,
}: StudioScreenProps) {
	const navigate = useNavigate();
	const prefersReducedMotion = useReducedMotion();

	// Intent eligibility was seeded by the route loader; this read is synchronous
	// from cache. The gate carries the criteria (for the IntentEditor's locked
	// treatment); the studio only needs `allowed`, collapsed here. Defaults to
	// locked so the teaser renders first-paint even if the pre-warm missed.
	const { data: intentGate } = useQuery(intentEligibilityQueryOptions());
	const isIntentEligible = intentGate?.allowed ?? false;

	// The seed initializes the draft ONCE. isIntentEligible is cache-synchronous
	// on first paint (loader-ensured), so gating the seeded intent here reproduces
	// the original single-screen handleSeed invariant exactly.
	const draft = useCreatePlaylistDraft(
		useMemo(
			() => studioSeedToDraftInit(seed, isIntentEligible),
			[seed, isIntentEligible],
		),
	);
	const [name, setName] = useState(() => seed.name ?? DEFAULT_NAME);
	const [showPaywall, setShowPaywall] = useState(false);

	// The seed card's "& add more" affordance lands here with the matching search
	// focused — artist search for the artist idea, genre search for the genre idea.
	const [focusArtistSearch] = useState(() => seed.focusArtistSearch ?? false);
	const [focusGenreSearch] = useState(() => seed.focusGenreSearch ?? false);

	// Proactively surface the reconnect/install/mismatch affordance at page
	// load so the user knows about a broken or wrong-account Spotify session
	// before attempting to create. The gate keeps re-checking while unhealthy
	// (focus/visibility + a manual "Check again" in the prompts) so recovering
	// in another tab isn't a dead end. linkedSpotifyId is what lets the gate
	// actually detect a mismatched extension account — see useSpotifyGate.ts.
	// CreateBar's per-state recovery prompts (ExtensionUnavailablePrompt /
	// ReconnectPrompt / AccountMismatchPrompt) each own their own
	// repairConnection call with the verdict their state needs, so this screen
	// only needs to hand them `recheck`.
	const { gate, recheck, reportGateFailure } = useSpotifyGate(linkedSpotifyId);

	// Owns the publish lifecycle (submit → success/partial/created-unsynced,
	// gate-failure routing, isSubmitting). Declared before `playback` below
	// since it's keyed on flow.result.
	const flow = usePublishPlaylist({ reportGateFailure });

	// Shared across the preview list AND the suggestions tray so only one
	// in-row Spotify preview plays at a time across the whole screen (U2).
	// resetKey: PreviewList and SuggestionsTray stay mounted regardless of
	// flow.result — only the footer swaps to SuccessState/PartialState/
	// UnsyncedState. Keying on flow.result?.status instead stops any in-flight
	// preview the moment a create result lands (and again on later status
	// transitions, e.g. a created-unsynced retry), rather than leaving an
	// iframe playing behind a footer that no longer matches it.
	const playback = useSingleActivePlayback(flow.result?.status ?? null);

	// Keep the transfer motion pending through the preview fetch so a slow query
	// cannot consume it before the newly added row actually appears.
	const { newSongIds, markSongAdded } = useSongAddHighlight(draft.tracklist);
	const handleAddSong = useCallback(
		(id: string) => {
			markSongAdded(id);
			draft.addSong(id);
		},
		[draft.addSong, markSongAdded],
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
			toast(
				<span className="toast-line">
					<span className="toast-line-verb">Dismissed</span>
					<span className="toast-line-subject">
						{song?.name ?? "song"}
						{song && <span className="toast-line-artist">{song.artist}</span>}
					</span>
				</span>,
				{
					action: {
						label: "Undo",
						onClick: () => draft.restoreSong(id),
					},
				},
			);
		},
		[draft.suggestions, draft.dismissSuggestion, draft.restoreSong],
	);

	// Payload assembly stays outside CreateBar, which is presentational. The
	// helper structurally limits publishing to the preview's committed config.
	const handleSubmit = useCallback(() => {
		void flow.submit(
			buildStudioSubmitInput(name, {
				tracklist: draft.tracklist,
				committedConfig: draft.committedConfig,
				intentApplied: draft.intentApplied,
			}),
		);
	}, [
		name,
		draft.tracklist,
		draft.committedConfig,
		draft.intentApplied,
		flow.submit,
	]);

	// Preview messaging is derived from the same committed max that produced the
	// tracklist, never the live value while its debounce is still in flight.
	// Once the debounce commits, placeholder rows still belong to the previous
	// config, so their totals cannot drive settled-state messaging yet.
	const { showNotEnoughNote, tracklistIsEmpty, isWarming } =
		getStudioPreviewState({
			totalEligible: draft.totalEligible,
			tracklistLength: draft.tracklist.length,
			committedMaxSongs: draft.committedConfig.maxSongs,
			isLoading: draft.isLoading || draft.isPreviewRefreshing,
		});

	const handleClearFilters = useCallback(() => {
		draft.setGenrePills([]);
		draft.setMatchFilters({ version: 1 });
	}, [draft.setGenrePills, draft.setMatchFilters]);

	// These states occupy the same surface, so paired timing keeps the swap
	// reading as one state change rather than unrelated entrances and exits.
	const previewStateMotion = prefersReducedMotion
		? {
				initial: false as const,
				animate: { opacity: 1, transition: { duration: 0 } },
				exit: { opacity: 0, transition: { duration: 0 } },
			}
		: {
				initial: { opacity: 0 },
				animate: {
					opacity: 1,
					transition: { duration: 0.14, ease: [0.25, 1, 0.5, 1] as const },
				},
				exit: {
					opacity: 0,
					transition: { duration: 0.1, ease: [0.25, 1, 0.5, 1] as const },
				},
			};

	return (
		<div className="mx-auto max-w-[1180px] pb-24">
			<header className="mb-10 flex items-start justify-between gap-6">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<button
						type="button"
						onClick={() => void navigate({ to: "/playlists" })}
						className="theme-text-muted focus-underline -ml-0.5 mb-3 inline-flex w-fit cursor-pointer items-center gap-1.5 text-[11px] tracking-widest uppercase transition-opacity duration-150 hover:opacity-70"
						style={{ fontFamily: fonts.body }}
					>
						<ArrowLeftIcon size={11} weight="regular" aria-hidden />
						Playlists
					</button>
					{/* The name is the page title; the visible control is an input, so the
					    heading in the a11y tree is a sibling sr-only h1. */}
					<h1 className="sr-only">{name.trim() || "Untitled playlist"}</h1>
					<input
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_LENGTH))}
						maxLength={MAX_NAME_LENGTH}
						placeholder="Name this playlist…"
						aria-label="Playlist name"
						className="theme-text text-page-title w-full bg-transparent leading-[0.95] font-extralight tracking-tight outline-none focus-underline"
						style={{ fontFamily: fonts.display }}
					/>
				</div>
			</header>

			<div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_220px] lg:items-start">
				<main>
					<div className="mb-5">
						<IntentEditor
							isEligible={isIntentEligible}
							value={draft.config.intent}
							onChange={draft.setIntent}
							onOpenPaywall={() => setShowPaywall(true)}
						/>
					</div>

					<div
						className="theme-surface-bg overflow-hidden"
						style={{
							borderRadius: 18,
							// @ts-expect-error -- corner-shape not in CSS typings
							cornerShape: "squircle",
						}}
					>
						<div className="px-5 py-2.5">
							<AnimatePresence mode="popLayout" initial={false}>
								{tracklistIsEmpty ? (
									isWarming ? (
										<motion.div key="preview-loading" {...previewStateMotion}>
											<PreviewListSkeleton />
										</motion.div>
									) : (
										<motion.div key="preview-empty" {...previewStateMotion}>
											<LibraryEmptyState onClearFilters={handleClearFilters} />
										</motion.div>
									)
								) : (
									<motion.div key="preview-list" {...previewStateMotion}>
										<PreviewList
											songs={draft.tracklist}
											isLoading={draft.isLoading}
											onRemoveSong={draft.removeSong}
											onRestoreSong={draft.restoreSong}
											onTogglePin={draft.togglePin}
											newSongIds={newSongIds}
											pinnedSongIds={draft.effectivePinnedSongIds}
											playback={playback}
										/>
									</motion.div>
								)}
							</AnimatePresence>

							{showNotEnoughNote && (
								<NotEnoughSongsNote
									totalEligible={draft.totalEligible}
									maxSongs={draft.committedConfig.maxSongs}
									onClearFilters={handleClearFilters}
								/>
							)}
						</div>

						{flow.result && (
							<div>
								<PublishResultRegion
									result={flow.result}
									isRetryingUnsynced={flow.isRetryingUnsynced}
									onRetryUnsynced={() => {
										if (gate.gateState === "account-mismatch") return;
										void flow.retryUnsynced();
									}}
									retryUnsyncedBlocked={gate.gateState === "account-mismatch"}
									mismatchDisplayName={
										gate.gateState === "account-mismatch"
											? gate.mismatchProfile.displayName
											: undefined
									}
								/>
							</div>
						)}
					</div>

					{draft.suggestions.length > 0 && (
						<div
							className="mt-5 overflow-hidden px-5 py-2.5"
							style={{
								borderRadius: 18,
								// @ts-expect-error -- corner-shape not in CSS typings
								cornerShape: "squircle",
								background:
									"oklch(from var(--t-surface) calc(l - 0.018) calc(c + 0.001) calc(h - 2))",
							}}
						>
							<SuggestionsTray
								suggestions={draft.suggestions}
								onAddSong={handleAddSong}
								onDismissSong={handleDismissSuggestion}
								onRefresh={draft.refreshSuggestions}
								playback={playback}
							/>
						</div>
					)}
					{!flow.result && (
						<div
							className="sticky bottom-0 z-10 mt-4"
							style={{
								background:
									"linear-gradient(to top, var(--t-bg) 60%, transparent)",
								paddingTop: 20,
								paddingBottom: 4,
							}}
						>
							<div
								className="theme-surface-bg overflow-hidden"
								style={{
									borderRadius: 16,
									// @ts-expect-error -- corner-shape not in CSS typings
									cornerShape: "squircle",
									boxShadow:
										"0 -2px 12px color-mix(in srgb, var(--t-text) 6%, transparent), 0 0 0 1px color-mix(in srgb, var(--t-border) 50%, transparent)",
								}}
							>
								<CreateBar
									name={name}
									songs={draft.tracklist}
									isPreviewStale={draft.isConfigStale}
									isResolvingArtists={draft.isResolvingArtists}
									isArtistResolutionError={draft.isArtistResolutionError}
									isSubmitting={flow.isSubmitting}
									gate={gate}
									accountDisplayName={accountDisplayName}
									onSubmit={handleSubmit}
									onRetryArtistResolution={draft.retryArtistResolution}
									onRecheck={recheck}
								/>
							</div>
						</div>
					)}
				</main>

				<aside className="flex flex-col gap-7 pt-1.5 lg:sticky lg:top-8">
					<GenreConfig
						accountId={accountId}
						value={draft.config.genrePills}
						onChange={draft.setGenrePills}
						autoFocusSearch={focusGenreSearch}
					/>
					<ArtistConfig
						selections={draft.artistSelections}
						onAddArtist={draft.addArtist}
						onToggleArtist={draft.toggleArtist}
						onRemoveArtist={draft.removeArtist}
						autoFocusSearch={focusArtistSearch}
						isResolutionError={draft.isArtistResolutionError}
						onRetryResolution={draft.retryArtistResolution}
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
