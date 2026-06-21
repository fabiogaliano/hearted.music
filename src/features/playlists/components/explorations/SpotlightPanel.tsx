import { useEffect, useState } from "react";
import type {
	PlaylistMatchFilterOptions,
	PlaylistMatchFiltersV1,
} from "@/lib/domains/taste/match-filters/types";
import type { DescriptionExample } from "./DescriptionExamplesShuffle";
import { DescriptionExamplesShuffle } from "./DescriptionExamplesShuffle";
import { ActiveFilterChips } from "./match-filters/ActiveFilterChips";
import type { OptionsState } from "./match-filters/AdvancedFiltersAssembly";
import { AdvancedFiltersAssembly } from "./match-filters/AdvancedFiltersAssembly";
import { SpotlightHero } from "./SpotlightHero";
import { TrackList } from "./TrackList";
import type {
	GuidedPlaylistsConfig,
	PlaylistSummary,
	PlaylistTrackVM,
} from "./types";
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

// The hue-washed band behind the hero + writing surface (and the guided example
// picker, which lifts off it as a lighter card).
const BAND_BG =
	"color-mix(in srgb, var(--t-primary) 12%, var(--t-surface-dim))";

interface SpotlightPanelProps {
	playlist: PlaylistSummary | null;
	tracks?: PlaylistTrackVM[];
	open: boolean;
	onClose: () => void;
	onToggleTarget?: (id: string) => void;
	/** Called when the user saves; receives all three match-config fields together.
	 *  CMHF-15 will replace the two separate RPCs with savePlaylistMatchConfig,
	 *  which accepts exactly this shape. */
	onSave?: (
		id: string,
		intent: string | null,
		genres: string[],
		matchFilters: PlaylistMatchFiltersV1,
	) => void;
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
	onSave = () => {},
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
	const [draftDescription, setDraftDescription] = useState("");
	const [draftGenres, setDraftGenres] = useState<string[]>([]);
	const [draftMatchFilters, setDraftMatchFilters] =
		useState<PlaylistMatchFiltersV1>({ version: 1 });

	// Reseed all three draft fields when a different playlist opens.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reseed only on identity change
	useEffect(() => {
		setDescription(playlist?.intent ?? null);
		setGenres(playlist?.genres ?? []);
		setMatchFilters(playlist?.matchFilters ?? { version: 1 });
		setIsEditing(false);
	}, [playlist?.id]);

	useEffect(() => {
		if (!open || !closable) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, closable, onClose]);

	const openEditor = () => {
		setDraftDescription(description ?? "");
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
	// biome-ignore lint/correctness/useExhaustiveDependencies: reacts to identity/target/intent; openEditor reads the current saved seeds
	useEffect(() => {
		const described = !!playlist?.intent && playlist.intent.trim() !== "";
		if (autoEditOnAdd && playlist?.isTarget && !described) openEditor();
	}, [playlist?.id, playlist?.isTarget, playlist?.intent, autoEditOnAdd]);
	// Picking a ready-made example seeds the draft from it and jumps straight into
	// editing — bypassing openEditor's reseed-from-saved, since the point is to
	// start from the example rather than the current intent. Filters carry over
	// from the saved state since examples don't touch filter state.
	const pickExample = (
		nextDescription: string,
		nextGenres: readonly string[],
	) => {
		setDraftDescription(nextDescription);
		setDraftGenres([...nextGenres]);
		setDraftMatchFilters(matchFilters);
		setIsEditing(true);
	};
	const save = () => {
		const nextDescription = draftDescription.trim() || null;
		setDescription(nextDescription);
		setGenres(draftGenres);
		setMatchFilters(draftMatchFilters);
		setIsEditing(false);
		if (playlist)
			onSave(playlist.id, nextDescription, draftGenres, draftMatchFilters);
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
								className="theme-text-muted absolute top-[26px] right-[22px] z-30 grid size-10 place-items-center text-[17px] transition-[color,transform] duration-150 hover:text-(--t-text) active:scale-[0.94] md:right-[30px]"
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
											className="min-h-0 overflow-hidden"
											inert={!playlist.isTarget}
										>
											{/* data-tour spotlight target for the "write intent" beat —
										    exactly the hue-washed writing surface, so the union with the
										    hero band frames just the mauve region, not the empty track
										    list below it. Inert in production. */}
											<div
												data-tour="intent-zone"
												className="relative z-20 px-5 pt-1 pb-9 md:px-10"
												style={{ background: BAND_BG }}
											>
												<div
													className={`max-w-[56ch] transition-opacity duration-300 ease-[var(--ease-out-expo)] motion-reduce:transition-none ${playlist.isTarget ? "opacity-100" : "opacity-0"}`}
												>
													<WritingSurface
														description={description}
														genres={genres}
														isEditing={isEditing}
														draftDescription={draftDescription}
														draftGenres={draftGenres}
														topGenres={topGenres}
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
																<ActiveFilterChips filters={matchFilters} />
															) : undefined
														}
														advancedFilters={
															isEditing && !guidedIntent ? (
																<AdvancedFiltersAssembly
																	filters={draftMatchFilters}
																	onFiltersChange={setDraftMatchFilters}
																	options={matchFilterOptions ?? EMPTY_OPTIONS}
																	optionsState={
																		matchFilterOptionsState ?? "loading"
																	}
																/>
															) : undefined
														}
														onEditDescription={openEditor}
														onEditGenres={openEditor}
														onDraftDescriptionChange={setDraftDescription}
														onDraftGenresChange={setDraftGenres}
														onSave={save}
														// Only exits editing; openEditor reseeds all three drafts
														// from saved values on the next open, so drafts need no reset here.
														onCancel={() => setIsEditing(false)}
													/>
												</div>
											</div>
										</div>
									</div>

									<div className="mt-8 flex flex-col gap-8">
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
