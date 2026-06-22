import { useEffect, useRef, useState } from "react";
import type {
	PlaylistMatchFilterOptions,
	PlaylistMatchFiltersV1,
} from "@/lib/domains/taste/match-filters/types";
import type { SavePlaylistMatchConfigResult } from "@/lib/server/playlists.functions";
import type { DescriptionExample } from "./DescriptionExamplesShuffle";
import { DescriptionExamplesShuffle } from "./DescriptionExamplesShuffle";
import type { OptionsState } from "./match-filters/MatchFiltersFieldList";
import { MatchFiltersFieldList } from "./match-filters/MatchFiltersFieldList";
import { MatchFiltersSummary } from "./match-filters/MatchFiltersSummary";
import { SpotlightHero } from "./SpotlightHero";
import { TrackList } from "./TrackList";
import type {
	GuidedPlaylistsConfig,
	PlaylistSummary,
	PlaylistTrackVM,
} from "./types";
import { useVocalsAutoFill } from "./useVocalsAutoFill";
import { WritingSurface } from "./WritingSurface";

/**
 * Empty options object used when CMHF-14 has not yet provided real options.
 * Controls will render disabled (optionsState="loading"), but draft chips remain removable.
 */
const EMPTY_OPTIONS: PlaylistMatchFilterOptions = {
	languages: [],
	releaseYears: { min: null, max: null },
	likedAt: { oldest: null, today: "", yearCounts: [] },
};

interface SpotlightPanelProps {
	playlist: PlaylistSummary | null;
	tracks?: PlaylistTrackVM[];
	open: boolean;
	onClose: () => void;
	onToggleTarget?: (id: string) => void;
	/**
	 * Called when the user saves. Receives all three match-config fields together.
	 * Must return a Promise — SpotlightPanel awaits it to decide whether to close
	 * (on fulfillment) or stay open and show an inline error (on rejection).
	 * The resolved value is the server-normalized config, used to reconcile local
	 * saved state so collapsed display reflects server normalization (trimmed intent,
	 * sanitized genres, normalized filters) rather than raw draft values.
	 */
	onSave?: (
		id: string,
		intent: string | null,
		genres: string[],
		matchFilters: PlaylistMatchFiltersV1,
	) => Promise<SavePlaylistMatchConfigResult>;
	topGenres?: readonly string[];
	/** More track pages exist — TrackList renders a scroll sentinel. */
	tracksHasMore?: boolean;
	/** A next track page is loading. */
	tracksLoadingMore?: boolean;
	/** Load the next track page (fired as the sentinel scrolls into view). */
	onLoadMoreTracks?: () => void;
	/** Onboarding rehearsal config. Presence activates guided mode; absence =
	 *  production defaults. See GuidedPlaylistsConfig for the full contract. */
	guided?: GuidedPlaylistsConfig;
	/** Global intent examples for the production editor's "(i)" shuffle-to-fill
	 *  popover. Ignored in guided mode (which uses its own per-playlist slot). */
	intentExamples?: readonly DescriptionExample[];
	/**
	 * Filter options from getPlaylistMatchFilterOptions (CMHF-14 wires the real query).
	 * Omit or pass undefined until CMHF-14 is ready — defaults to EMPTY_OPTIONS with
	 * optionsState="loading" so controls are disabled but draft chips remain removable.
	 */
	matchFilterOptions?: PlaylistMatchFilterOptions;
	/**
	 * Loading/error state for filter options. CMHF-14 sets this from the query status.
	 * Defaults to "loading" so the UI is safely disabled before options arrive.
	 */
	matchFilterOptionsState?: OptionsState;
}

/**
 * The Spotlight detail panel as a whole: a right-side slide-in drawer
 * (full-screen below the lg breakpoint — phones and tablets — and a clamped
 * side column on desktop, matching the liked-songs detail panel) with a scrim,
 * the hue-washed hero, then the writing surface, voices line, and track list on
 * plain bg. It owns the writing-surface draft state so it drops into a story or
 * a route the same way; persistence is surfaced via onSave for the caller to wire.
 *
 * A fixed, overflow-hidden frame clips the off-canvas panel so a closed drawer
 * never adds a phantom horizontal scrollbar. The drawer body scrolls inside an
 * inner wrapper while the close button stays pinned to the panel — on a
 * full-screen phone the scrim is fully covered, so the ✕ is the only way out and
 * must never scroll away with the track list.
 */
export function SpotlightPanel({
	playlist,
	tracks = [],
	open,
	onClose,
	onToggleTarget = () => {},
	onSave = () =>
		Promise.resolve({
			matchIntent: null,
			genrePills: [],
			matchFilters: { version: 1 as const },
		}),
	topGenres,
	tracksHasMore = false,
	tracksLoadingMore = false,
	onLoadMoreTracks,
	guided,
	intentExamples,
	matchFilterOptions,
	matchFilterOptionsState,
}: SpotlightPanelProps) {
	// Expand the guided config into local constants so the rest of the component
	// reads the same way it did before — production defaults are explicit here and
	// the guided path overrides only what it needs.
	const closable = guided ? !guided.locked : true;
	const highlightAdd = guided?.highlightAdd ?? false;
	const autoEditOnAdd = guided?.autoEditOnAdd ?? false;
	const intentPlaceholder = guided?.intentPlaceholder;
	const guidedIntent = guided != null;
	const hideUnmatchableWarning = guided != null;
	const hideTracksEmptyState = guided != null;
	const examples = guided?.examples;
	const [description, setDescription] = useState<string | null>(
		playlist?.intent ?? null,
	);
	const [genres, setGenres] = useState<string[]>(playlist?.genres ?? []);
	const [matchFilters, setMatchFilters] = useState<PlaylistMatchFiltersV1>(
		playlist?.matchFilters ?? { version: 1 },
	);
	const [isEditing, setIsEditing] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [draftDescription, setDraftDescription] = useState("");
	const [draftGenres, setDraftGenres] = useState<string[]>([]);
	const [draftMatchFilters, setDraftMatchFilters] =
		useState<PlaylistMatchFiltersV1>({ version: 1 });

	// True once the matching band has finished opening. While open we drop the
	// band's overflow clip so the editor's downward popovers (genre search, info
	// tips) can spill past the band into the track-list area instead of being
	// sliced at the boundary. Re-clipped the moment it collapses so a closed band
	// never leaks its content.
	const [bandSettled, setBandSettled] = useState(playlist?.isTarget ?? false);

	// The saved intent text at the moment the editor was most recently opened.
	// Passed to useVocalsAutoFill so it can pre-seed the dismissal set and
	// prevent auto-fill from firing on unchanged saved text when the editor reopens.
	const autoFillInitialTextRef = useRef<string>("");

	// Identity of the playlist currently on screen, kept fresh every render. An
	// in-flight save captures the id it is saving; comparing against this ref when
	// the RPC resolves lets a stale save bail out instead of reconciling playlist
	// A's server result into a panel that has since switched to playlist B.
	const currentPlaylistIdRef = useRef<string | null>(playlist?.id ?? null);
	currentPlaylistIdRef.current = playlist?.id ?? null;

	// Reseed all three saved fields when a different playlist opens. Also resets
	// transient edit/save state so a new panel starts clean.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reseed only on identity change
	useEffect(() => {
		setDescription(playlist?.intent ?? null);
		setGenres(playlist?.genres ?? []);
		setMatchFilters(playlist?.matchFilters ?? { version: 1 });
		setIsEditing(false);
		setIsSaving(false);
		setSaveError(null);
	}, [playlist?.id]);

	// Settle the band via a timeout rather than transitionend so reduced-motion —
	// where the grid-rows transition is suppressed and never fires an end event —
	// still un-clips. ~420ms matches the 400ms open animation; collapsing re-clips
	// synchronously so the closing band stays masked.
	useEffect(() => {
		const target = playlist?.isTarget ?? false;
		if (!target) {
			setBandSettled(false);
			return;
		}
		const id = window.setTimeout(() => setBandSettled(true), 420);
		return () => window.clearTimeout(id);
	}, [playlist?.isTarget]);

	useVocalsAutoFill({
		isEditing,
		lockManualEntry: guidedIntent,
		draftDescription,
		draftMatchFilters,
		setDraftMatchFilters,
		initialText: autoFillInitialTextRef.current,
		sessionKey: playlist?.id ?? null,
	});

	useEffect(() => {
		if (!open || !closable) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, closable, onClose]);

	const openEditor = () => {
		const initialText = description ?? "";
		// Record the text the session starts from so the auto-fill hook can
		// pre-seed it as dismissed — unchanged saved intent must not auto-fill.
		autoFillInitialTextRef.current = initialText;
		setDraftDescription(initialText);
		setDraftGenres(genres);
		setDraftMatchFilters(matchFilters);
		setIsEditing(true);
	};

	// Walkthrough: when the guided panel shows a matching playlist with no intent yet,
	// drop straight into the editor (textarea + example picker) so "add" flows into
	// "write intent" without a tap — and a refresh that reopened a flagged-but-
	// undescribed playlist lands there too, instead of the collapsed Edit affordance.
	// A described playlist (or any playlist once the cycle releases, where
	// autoEditOnAdd is off) stays collapsed.
	//
	// Seeds are read straight from the `playlist` prop, not from the committed
	// description/genres/matchFilters state: when this fires on an identity change,
	// the reseed effect above has only *queued* the new playlist's values, so the
	// state copies still hold the previous playlist's data this flush. The prop is
	// already the new playlist, so a direct B→C switch can't seed C with B's intent.
	// biome-ignore lint/correctness/useExhaustiveDependencies: genres/matchFilters are read fresh from the prop, intentionally excluded so a background refetch can't reopen a mid-edit panel
	useEffect(() => {
		const described = !!playlist?.intent && playlist.intent.trim() !== "";
		if (!autoEditOnAdd || !playlist?.isTarget || described) return;
		const initialText = playlist.intent ?? "";
		autoFillInitialTextRef.current = initialText;
		setDraftDescription(initialText);
		setDraftGenres(playlist.genres ?? []);
		setDraftMatchFilters(playlist.matchFilters ?? { version: 1 });
		setIsEditing(true);
	}, [playlist?.id, playlist?.isTarget, playlist?.intent, autoEditOnAdd]);
	// Picking a ready-made example seeds the draft from it and jumps straight into
	// editing — bypassing openEditor's reseed-from-saved, since the point is to
	// start from the example rather than the current intent. Filters carry over
	// from the saved state since examples don't touch filter state.
	const pickExample = (
		nextDescription: string,
		nextGenres: readonly string[],
	) => {
		// Guided mode — auto-fill is suppressed (lockManualEntry), but still
		// seed the ref so the hook initialText is consistent if mode ever changes.
		autoFillInitialTextRef.current = nextDescription;
		setDraftDescription(nextDescription);
		setDraftGenres([...nextGenres]);
		setDraftMatchFilters(matchFilters);
		setIsEditing(true);
	};
	const save = async () => {
		if (!playlist) return;
		const savedPlaylistId = playlist.id;
		// Clear any previous save error at the start of a new attempt.
		setSaveError(null);
		setIsSaving(true);
		try {
			const normalized = await onSave(
				savedPlaylistId,
				draftDescription.trim() || null,
				draftGenres,
				draftMatchFilters,
			);
			// Ignore a resolution that lands after the user switched/closed onto a
			// different playlist — otherwise A's server result would reconcile into
			// whichever playlist the panel shows now.
			if (currentPlaylistIdRef.current !== savedPlaylistId) return;
			// Reconcile local saved state from the server's normalized response so
			// collapsed display reflects server normalization (trimmed intent,
			// sanitized genres, normalized filters) rather than raw draft values.
			setDescription(normalized.matchIntent);
			setGenres(normalized.genrePills);
			setMatchFilters(normalized.matchFilters);
			setIsEditing(false);
		} catch {
			// Same staleness guard for the failure path: don't surface A's error on
			// B's panel.
			if (currentPlaylistIdRef.current !== savedPlaylistId) return;
			setSaveError("Couldn't save changes. Try again.");
		} finally {
			// Leave the new playlist's saving flag alone if we've since switched —
			// the reseed effect already reset it for that playlist.
			if (currentPlaylistIdRef.current === savedPlaylistId) setIsSaving(false);
		}
	};

	return (
		<div
			aria-hidden={!open}
			className={`fixed inset-0 z-50 overflow-hidden ${open ? "" : "pointer-events-none"}`}
		>
			<button
				type="button"
				aria-label="Close panel"
				tabIndex={open && closable ? 0 : -1}
				onClick={closable ? onClose : undefined}
				className={`absolute inset-0 cursor-default border-0 transition-opacity duration-200 ease-[var(--ease-out-quart)] motion-reduce:transition-none ${open ? "opacity-100" : "opacity-0"}`}
				style={{
					background: "color-mix(in srgb, var(--t-text) 22%, transparent)",
				}}
			/>

			<aside
				className={`theme-bg theme-border-color absolute top-0 right-0 flex h-full w-full flex-col overflow-hidden transition-transform duration-300 ease-[var(--ease-out-quart)] motion-reduce:transition-none lg:w-[clamp(520px,56vw,760px)] lg:border-l ${open ? "translate-x-0" : "translate-x-full"}`}
				style={{
					boxShadow:
						"-24px 0 60px -30px color-mix(in srgb, var(--t-text) 40%, transparent)",
				}}
			>
				{playlist && (
					<>
						{closable && (
							<button
								type="button"
								onClick={onClose}
								aria-label="Close"
								className="theme-text-muted absolute top-[26px] right-0 z-30 grid size-10 place-items-center text-[17px] transition-[color,transform] duration-150 hover:text-(--t-text) active:scale-[0.96] motion-reduce:transition-none md:right-5"
							>
								✕
							</button>
						)}

						<div className="flex-1 overflow-y-auto overscroll-contain">
							<div className="relative px-5 pt-[30px] pb-20 md:px-10 md:pt-[34px]">
								<SpotlightHero
									playlist={playlist}
									onToggleTarget={() => onToggleTarget(playlist.id)}
									highlightToggle={highlightAdd}
								/>

								<div>
									{/* The matching intent only matters once the playlist is in the
								    matching set, so the writing surface stays collapsed until then.
								    The grid-rows 0fr→1fr trick animates to the band's natural height
								    (no magic max-height); the bleed lives on this wrapper so the inner
								    overflow-hidden can clip the collapse vertically without cutting the
								    band's horizontal edge-bleed. Driven straight off isTarget, the
								    transition stays put on first paint — opening an already-matching
								    playlist is instant; only the in-place Add-to-matching toggle grows
								    it. The gap above the track list lives on the track-list wrapper
								    (mt-8), not inside this clipped box, so it stays constant whether
								    the band is open or collapsed — a collapsed band must not pull the
								    "no tracks yet" empty state flush against the hero.
								    DELIBERATE product decision: the intent editor is only useful once
								    the playlist is in the matching set ("Add to matching" first), so
								    it stays collapsed until isTarget is true — this is not an
								    onboarding leak and should not be "fixed" to always show. */}
									<div
										className="grid -mx-5 transition-[grid-template-rows] duration-[400ms] ease-[var(--ease-out-expo)] motion-reduce:transition-none md:-mx-10"
										style={{
											gridTemplateRows: playlist.isTarget ? "1fr" : "0fr",
										}}
									>
										<div
											className={`min-h-0 ${playlist.isTarget && bandSettled ? "overflow-visible" : "overflow-hidden"}`}
											inert={!playlist.isTarget}
										>
											{/* data-tour spotlight target for the "write intent" beat.
										    Two-tone hierarchy grouped by meaning: the hero AND the
										    matching config share one continuous band (--t-surface-dim),
										    reading as a single "what this is / how it matches" zone;
										    only the track list below sits on the lighter page bg. One
										    even lightness step, same hue+saturation, no temperature
										    break — and the tonal boundary lands between the rules and
										    the contents, where it belongs. The config's internal
										    structure comes from its hairline-divided sections, not a
										    competing fill. Inert in production. */}
											<div
												data-tour="intent-zone"
												className="theme-border-color relative z-20 border-b px-5 pt-2 pb-8 md:px-10"
												style={{ background: "var(--t-surface-dim)" }}
											>
												<div
													className={`transition-opacity duration-300 ease-[var(--ease-out-expo)] motion-reduce:transition-none ${playlist.isTarget ? "opacity-100" : "opacity-0"}`}
												>
													<WritingSurface
														description={description}
														genres={genres}
														isEditing={isEditing}
														draftDescription={draftDescription}
														draftGenres={draftGenres}
														topGenres={topGenres}
														isSaving={isSaving}
														saveError={saveError}
														hideUnmatchableWarning={hideUnmatchableWarning}
														intentPlaceholder={intentPlaceholder}
														lockManualEntry={guidedIntent}
														intentExamples={intentExamples}
														examplesSlot={
															guidedIntent &&
															examples &&
															examples.length > 0 ? (
																<DescriptionExamplesShuffle
																	onPick={pickExample}
																	examples={examples}
																	variant="guided"
																/>
															) : undefined
														}
														collapsedFiltersSlot={
															!isEditing && !guidedIntent ? (
																<MatchFiltersSummary
																	filters={matchFilters}
																	onEdit={openEditor}
																/>
															) : undefined
														}
														advancedFilters={
															isEditing && !guidedIntent ? (
																<MatchFiltersFieldList
																	filters={draftMatchFilters}
																	onFiltersChange={setDraftMatchFilters}
																	options={matchFilterOptions ?? EMPTY_OPTIONS}
																	optionsState={
																		matchFilterOptionsState ?? "loading"
																	}
																	isSaving={isSaving}
																/>
															) : undefined
														}
														onEditDescription={openEditor}
														onEditGenres={openEditor}
														onDraftDescriptionChange={setDraftDescription}
														onDraftGenresChange={setDraftGenres}
														onSave={() => {
															void save();
														}}
														// Cancel reverts the draft to saved state and clears the inline save
														// error. openEditor also reseeds on the next open, but resetting here
														// keeps draft state from lingering dirty while collapsed.
														onCancel={() => {
															setDraftDescription(description ?? "");
															setDraftGenres(genres);
															setDraftMatchFilters(matchFilters);
															setIsEditing(false);
															setSaveError(null);
														}}
													/>
												</div>
											</div>
										</div>
									</div>

									<div
										className={`mt-8 flex flex-col gap-8 transition-opacity duration-300 ease-[var(--ease-out-quart)] motion-reduce:transition-none ${isEditing ? "opacity-40" : "opacity-100"}`}
									>
										{/* While editing the matching config the track list recedes so
									    the form holds focus (Direction B). It stays in the DOM and
									    scrollable — just dimmed — rather than unmounting. */}
										{/* The pick-an-intent examples helper lives only in guided
									    onboarding now (the examplesSlot inside the intent field).
									    Once onboarding is done, the production editor stands on its
									    own — no examples rail below the writing surface. */}
										<TrackList
											tracks={tracks}
											songCount={playlist.songCount}
											hasMore={tracksHasMore}
											isLoadingMore={tracksLoadingMore}
											onLoadMore={onLoadMoreTracks}
											hideEmptyState={hideTracksEmptyState}
										/>
									</div>
								</div>
							</div>
						</div>
					</>
				)}
			</aside>
		</div>
	);
}
