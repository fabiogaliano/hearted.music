/**
 * Per-card whole-card mutation surface — extracted from match.tsx (Deepening
 * #2). Owns the four whole-card writes (skip-unavailable, dismiss, finish,
 * add-suggestion) via useLockedMutation, and the per-orientation add
 * resolution (addSuggestion). Navigation/session state is owned by the
 * caller's useMatchDeckSession and reaches this component only through
 * `sessionActions` — no raw setState dispatchers cross this boundary.
 */

import { type useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { MatchModeToggle } from "@/features/matching/components/MatchModeToggle";
import { isDeckActionSuccess } from "@/features/matching/deck-action-status";
import {
	matchDeckQueryOptions,
	readMatchDeckCardQueryOptions,
} from "@/features/matching/deck-queries";
import { Matching } from "@/features/matching/Matching";
import {
	deriveProgressIndex,
	shouldOfferLoosenStrictness,
} from "@/features/matching/queue-helpers";
import { seedBakedDeckCardReads } from "@/features/matching/seed-deck-cards";
import { useMatchReviewCard } from "@/features/matching/useMatchReviewCard";
import { outcomeFromCommandResponse } from "@/lib/extension/spotify-action-outcome";
import { addToPlaylist } from "@/lib/extension/spotify-client";
import { useSpotifyReconnectState } from "@/lib/extension/useSpotifyReconnectState";
import { useLockedMutation } from "@/lib/hooks/useLockedMutation";
import type { useAnalytics } from "@/lib/observability/useAnalytics";
import {
	type StartOrResumeMatchDeckResult,
	type SubmitMatchDeckActionResult,
	submitMatchDeckAction,
} from "@/lib/server/match-deck.functions";
import { fonts } from "@/lib/theme/fonts";
import type {
	CompletionStats,
	MatchingReviewItem,
	MatchingSuggestion,
	MatchViewMode,
	ReviewedItem,
} from "./types";
import type { MatchDeckSessionActions } from "./useMatchDeckSession";

// Rejection statuses (across finish-card/dismiss-card) that mean the
// client's view is stale — the item already resolved via another tab/session
// or no longer exists. The server's `result.view` returned alongside the
// rejection is authoritative, so these reconcile to it instead of retrying
// into the same rejection forever (M7). `no_captured_pairs` is deliberately
// excluded: it is a transient not-yet-captured case, root-caused elsewhere
// (H4), and stays a plain retry.
const STALE_REJECTION_STATUSES = new Set(["already_resolved", "not_found"]);

/**
 * Outcome of an add-to-playlist decision, uniform across the song/playlist
 * orientation branches (Patterns #2 — collapses the ~50 duplicated lines each
 * branch used to repeat for the submit-then-classify-then-update-stats shape).
 */
interface AddOutcome {
	status: "added" | "reconnect-required" | "spotify-error" | "rejected";
	suggestionId: string;
	analyticsPayload?: Record<string, unknown>;
	/** Id folded into songsWithAdditions on a successful add. */
	addedStatKey?: string;
}

/**
 * Resolves an add-suggestion decision for either orientation: writes through
 * to Spotify first (best-effort — only when both sides have a spotifyId),
 * then persists the decision server-side. Pure w.r.t. React state — the
 * caller (addSuggestionMutation's onSuccess/onRetryableFailure) applies the
 * outcome to component state.
 */
async function addSuggestion({
	suggestionId,
	currentReviewItem,
	currentSuggestions,
	currentSong,
	currentPlaylist,
	itemId,
}: {
	suggestionId: string;
	currentReviewItem: MatchingReviewItem | null;
	currentSuggestions: MatchingSuggestion[];
	currentSong: { id: string; spotifyId?: string | null } | null;
	currentPlaylist: {
		id: string;
		spotifyId?: string | null;
		name: string;
	} | null;
	itemId: string;
}): Promise<AddOutcome> {
	if (currentReviewItem?.mode === "song") {
		// Song mode: suggestionId is a playlist id; add the review song to that playlist.
		const currentMatches = currentSuggestions
			.filter(
				(s): s is Extract<MatchingSuggestion, { mode: "song" }> =>
					s.mode === "song",
			)
			.map((s) => s.playlist);
		const playlist = currentMatches.find((p) => p.id === suggestionId);

		if (playlist?.spotifyId && currentSong?.spotifyId) {
			const result = await addToPlaylist(
				`spotify:playlist:${playlist.spotifyId}`,
				[`spotify:track:${currentSong.spotifyId}`],
			);
			const outcome = outcomeFromCommandResponse(result);
			if (outcome.status === "reconnect-required") {
				return { status: "reconnect-required", suggestionId };
			}
			if (outcome.status === "error") {
				return { status: "spotify-error", suggestionId };
			}
		}

		const addResult = await submitMatchDeckAction({
			data: { type: "add-suggestion", itemId, suggestionId },
		});
		if (!isDeckActionSuccess("add-suggestion", addResult.actionStatus)) {
			return { status: "rejected", suggestionId };
		}

		return {
			status: "added",
			suggestionId,
			analyticsPayload: {
				song_id: currentSong?.id,
				playlist_id: suggestionId,
				playlist_name: playlist?.name,
				orientation: "song",
			},
			addedStatKey: currentSong?.id,
		};
	}

	// Playlist mode: suggestionId is a song id; add that song to the review playlist.
	const songSuggestions = currentSuggestions
		.filter(
			(s): s is Extract<MatchingSuggestion, { mode: "playlist" }> =>
				s.mode === "playlist",
		)
		.map((s) => s.song);
	const suggestionSong = songSuggestions.find((s) => s.id === suggestionId);

	if (currentPlaylist?.spotifyId && suggestionSong?.spotifyId) {
		const result = await addToPlaylist(
			`spotify:playlist:${currentPlaylist.spotifyId}`,
			[`spotify:track:${suggestionSong.spotifyId}`],
		);
		const outcome = outcomeFromCommandResponse(result);
		if (outcome.status === "reconnect-required") {
			return { status: "reconnect-required", suggestionId };
		}
		if (outcome.status === "error") {
			return { status: "spotify-error", suggestionId };
		}
	}

	const addResult = await submitMatchDeckAction({
		data: { type: "add-suggestion", itemId, suggestionId },
	});
	if (!isDeckActionSuccess("add-suggestion", addResult.actionStatus)) {
		return { status: "rejected", suggestionId };
	}

	return {
		status: "added",
		suggestionId,
		analyticsPayload: {
			song_id: suggestionId,
			playlist_id: currentPlaylist?.id,
			playlist_name: currentPlaylist?.name,
			orientation: "playlist",
		},
		// Track the review playlist as the matched review item (E12 generalization).
		addedStatKey: currentPlaylist?.id,
	};
}

// Header for the non-ready cards (unavailable / retryable-error). Mirrors the
// ready card's "Matching / X of Y" heading but pairs it with the orientation
// toggle so a user stuck on one of these states can still switch modes (A2)
// instead of being stranded. No progress bar — these cards aren't a live
// position in the walk.
function NonReadyCardHeader({
	progressIndex,
	total,
	mode,
	disabled,
	onModeChange,
}: {
	progressIndex: number;
	total: number;
	mode: MatchViewMode;
	disabled: boolean;
	onModeChange: (mode: MatchViewMode) => void;
}) {
	return (
		<div className="mb-12 flex items-end justify-between gap-6">
			<div>
				<p
					className="theme-text-muted text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
				>
					Matching
				</p>
				<h2
					className="theme-text mt-3 text-3xl font-extralight tabular-nums leading-none"
					style={{ fontFamily: fonts.display }}
				>
					<span>{progressIndex + 1}</span>
					<span className="theme-text-muted opacity-60"> / {total}</span>
				</h2>
			</div>
			<MatchModeToggle
				mode={mode}
				disabled={disabled}
				onModeChange={onModeChange}
			/>
		</div>
	);
}

interface QueueCardContentProps {
	/** Deck orientation owner — scopes the deck cache key applied after actions. */
	accountId: string;
	itemId: string;
	currentIndex: number;
	// Full session size (deck progress.total, append-only). The progress header's
	// denominator, distinct from currentIndex/unresolvedIds which live in the
	// shrinking navigable domain.
	total: number;
	/** URL-backed orientation for this session — forwarded to the header toggle. */
	mode: MatchViewMode;
	unresolvedIds: string[];
	addedTo: string[];
	navigationStatus: "idle" | "pending";
	pastItems: ReviewedItem[];
	completionStats: CompletionStats;
	/** Session state mutators — owned by the caller's useMatchDeckSession. */
	sessionActions: MatchDeckSessionActions;
	/** Navigates to the canonical URL for the new mode and persists the preference. */
	onModeChange: (mode: MatchViewMode) => void;
	onExit: () => void;
	analytics: ReturnType<typeof useAnalytics>;
	queryClient: ReturnType<typeof useQueryClient>;
}

export function QueueCardContent({
	accountId,
	itemId,
	currentIndex,
	total,
	mode,
	unresolvedIds,
	addedTo,
	navigationStatus,
	pastItems,
	completionStats,
	sessionActions,
	onModeChange,
	onExit,
	analytics,
	queryClient,
}: QueueCardContentProps) {
	// Authoritative card render: a pure read over captured pair rows (plan §7).
	// The loader seeded current+next and a whole-card action seeds the promoted
	// cards, so an advance renders from cache instead of suspending; a browse to a
	// further card reads it on demand (no capture side effect — RE).
	const { data: itemData } = useSuspenseQuery(
		readMatchDeckCardQueryOptions(itemId),
	);

	// Warm the next card's read query so a forward advance renders from cache
	// instead of suspending. Only next1 is warmed — one card ahead, the card a
	// forward Previous/Next lands on — and it dedupes with the cache the action
	// seeding already populated.
	useEffect(() => {
		const next1 = unresolvedIds[currentIndex + 1];
		if (next1) {
			queryClient.prefetchQuery(readMatchDeckCardQueryOptions(next1));
		}
	}, [queryClient, currentIndex, unresolvedIds]);

	// QueueCardContent persists across cards (see the render site — it is not
	// keyed), so this no longer runs on a fresh mount per card. The previous card's
	// successful action leaves navigation locked (status "pending"); re-running on
	// itemId change clears the lock once we land on the next card. onReleaseNavigation
	// is stable (useCallback), so itemId is the only trigger.
	// biome-ignore lint/correctness/useExhaustiveDependencies: itemId is an intentional re-sync trigger, not a value read in the body — the lock must release when the current card changes, mirroring the old release-on-mount behavior.
	useEffect(() => {
		sessionActions.releaseNavigation();
	}, [itemId, sessionActions.releaseNavigation]);

	// Present-card mapping, tail paging, and suggestion-dismiss cache behavior
	// are owned by the hook (Deepening #2 tracer bullet) — this component stays
	// responsible for navigation/session concerns only.
	const {
		currentReviewItem,
		currentSuggestions,
		suggestionTotal,
		hasMoreSuggestions,
		isLoadingMoreSuggestions,
		loadMoreSuggestions,
		loadMoreError,
		retryLoadMore,
		dismissSuggestion,
		waitForPendingDismisses,
	} = useMatchReviewCard({ itemId, itemData, queryClient });

	// Narrow helpers — each is null when the other orientation is active.
	const currentSong =
		currentReviewItem?.mode === "song" ? currentReviewItem.song : null;
	const currentPlaylist =
		currentReviewItem?.mode === "playlist" ? currentReviewItem.playlist : null;

	const songId =
		currentReviewItem?.mode === "song" ? currentReviewItem.song.id : "";
	const { reconnectNeeded, setReconnectNeeded } =
		useSpotifyReconnectState(songId);

	// Header progress: position within the whole session, NOT within the shrinking
	// navigable list. Resolved cards drop out of unresolvedIds, so currentIndex is
	// always ~0 (the current card is the head of what's left); using it as the
	// numerator pinned the display at 1/N and made N count down as cards resolved.
	// total − remaining advances the numerator instead.
	const progressIndex = deriveProgressIndex(total, unresolvedIds.length);

	// Applies a whole-card action's returned deck view (RF): the server already
	// advanced the deck in-txn, so the fresh view carries the promoted current +
	// next cards. Seed both card reads (so the advance renders from cache), write
	// the view into the deck cache (so the parent re-renders over the new itemIds),
	// then move the id pointer to the promoted current — null when caught up.
	//
	// M9: cancels any in-flight reads for the cards we are about to seed before
	// writing. The warm-ahead prefetch effect above fetches the next card ahead
	// of time; without cancelling first, that fetch can settle AFTER this write
	// and clobber the fresher server-provided payload with a stale one.
	// Mirrors dismissSuggestionMutation's onMutate cancel (mutations.ts).
	const applyResolvedView = async (nextView: StartOrResumeMatchDeckResult) => {
		const cardKeys =
			"itemIds" in nextView
				? [nextView.cards.current, nextView.cards.next]
						.filter((card): card is NonNullable<typeof card> => card !== null)
						.map((card) => readMatchDeckCardQueryOptions(card.itemId).queryKey)
				: [];

		await Promise.all(
			cardKeys.map((queryKey) => queryClient.cancelQueries({ queryKey })),
		);

		queryClient.setQueryData(
			matchDeckQueryOptions(accountId, mode).queryKey,
			nextView,
		);
		if (!("itemIds" in nextView)) {
			sessionActions.advanceTo(null);
			return;
		}
		await seedBakedDeckCardReads(queryClient, [
			nextView.cards.current,
			nextView.cards.next,
		]);
		sessionActions.advanceTo(
			nextView.cards.current?.itemId ?? nextView.itemIds[0] ?? null,
		);
	};

	// Reconciles a whole-card action's rejection to the server's fresh view
	// instead of retrying into the same rejection (M7). Shared by every
	// whole-card mutation below (skip/dismiss/next all submit a "finish-card" or
	// "dismiss-card" action and treat already_resolved/not_found the same way).
	const isStaleRejection = (result: SubmitMatchDeckActionResult) =>
		STALE_REJECTION_STATUSES.has(result.actionStatus);

	// Whole-card mutations declared up front (useLockedMutation calls a hook
	// internally, so they must run unconditionally on every render — not inside
	// the unavailable/retryable-error branches below where the old inline
	// handlers used to live).
	const skipUnavailableMutation = useLockedMutation<
		undefined,
		SubmitMatchDeckActionResult
	>(queryClient, {
		operation: "match.skipUnavailable",
		onLockNavigation: sessionActions.lockNavigation,
		onReleaseNavigation: sessionActions.releaseNavigation,
		mutationFn: () =>
			submitMatchDeckAction({ data: { type: "finish-card", itemId } }),
		isSuccess: (result) =>
			isDeckActionSuccess("finish-card", result.actionStatus),
		isStale: isStaleRejection,
		onStale: (result) => applyResolvedView(result.view),
		onSuccess: async (result) => {
			// An unavailable card the user moves past is a skip.
			sessionActions.recordSkip();
			// Advance to the deck's promoted next card; the unavailable card leaves
			// navigation because the server dropped it from itemIds.
			await applyResolvedView(result.view);
		},
	});

	const dismissCardMutation = useLockedMutation<
		undefined,
		SubmitMatchDeckActionResult
	>(queryClient, {
		operation: "match.dismissCard",
		onLockNavigation: sessionActions.lockNavigation,
		onReleaseNavigation: sessionActions.releaseNavigation,
		mutationFn: async () => {
			await waitForPendingDismisses();
			recordCurrentItem();
			if (currentReviewItem?.mode === "song") {
				analytics.capture("song_dismissed", {
					song_id: currentReviewItem.song.id,
				});
			}
			return submitMatchDeckAction({ data: { type: "dismiss-card", itemId } });
		},
		isSuccess: (result) =>
			isDeckActionSuccess("dismiss-card", result.actionStatus),
		isStale: isStaleRejection,
		onStale: (result) => applyResolvedView(result.view),
		onSuccess: async (result) => {
			sessionActions.recordDismissal();
			sessionActions.clearAddedTo();
			await applyResolvedView(result.view);
		},
	});

	const nextMutation = useLockedMutation<
		undefined,
		SubmitMatchDeckActionResult
	>(queryClient, {
		operation: "match.finishCard",
		onLockNavigation: sessionActions.lockNavigation,
		onReleaseNavigation: sessionActions.releaseNavigation,
		mutationFn: async () => {
			await waitForPendingDismisses();
			recordCurrentItem();
			return submitMatchDeckAction({ data: { type: "finish-card", itemId } });
		},
		isSuccess: (result) =>
			isDeckActionSuccess("finish-card", result.actionStatus),
		isStale: isStaleRejection,
		onStale: (result) => applyResolvedView(result.view),
		onSuccess: async (result) => {
			// Finishing a card with no adds is a skip; with adds it's a match
			// (already counted via songsWithAdditions on each add). Check before
			// clearing addedTo.
			if (addedTo.length === 0) {
				sessionActions.recordSkip();
			}
			sessionActions.clearAddedTo();
			await applyResolvedView(result.view);
		},
	});

	const addSuggestionMutation = useLockedMutation<string, AddOutcome>(
		queryClient,
		{
			operation: "match.addSuggestion",
			onLockNavigation: sessionActions.lockNavigation,
			onReleaseNavigation: sessionActions.releaseNavigation,
			releaseOnSuccess: true,
			mutationFn: (suggestionId) => {
				setReconnectNeeded(false);
				return addSuggestion({
					suggestionId,
					currentReviewItem,
					currentSuggestions,
					currentSong,
					currentPlaylist,
					itemId,
				});
			},
			isSuccess: (outcome) => outcome.status === "added",
			onSuccess: (outcome) => {
				if (outcome.analyticsPayload) {
					analytics.capture("song_added_to_playlist", outcome.analyticsPayload);
				}
				sessionActions.recordAddition(
					outcome.suggestionId,
					outcome.addedStatKey,
				);
			},
			onRetryableFailure: (outcome) => {
				if (outcome.status === "reconnect-required") setReconnectNeeded(true);
			},
		},
	);

	// Unavailable card: the item cannot be shown. The body copy is the server's
	// real `message` for the specific `reason` (not-entitled, missing-song,
	// snapshot-not-owned, already-resolved, no-visible-suggestions) — the old
	// code re-derived a "no longer available" string from the URL mode, which was
	// wrong for the no-visible-suggestions reason (A1). Skip resolves the card via
	// finish-card. When the subject only has matches hidden under the strictness
	// bar (no-visible-suggestions), a recoverable "loosen strictness" link is the
	// primary affordance instead.
	if (itemData.status === "unavailable") {
		const loosenStrictness = shouldOfferLoosenStrictness(itemData.reason);
		const skipLabel = mode === "playlist" ? "Skip Playlist" : "Skip Song";

		const handleSkipUnavailable = async () => {
			await skipUnavailableMutation.run(undefined);
		};

		return (
			<div>
				<NonReadyCardHeader
					progressIndex={progressIndex}
					total={total}
					mode={mode}
					disabled={navigationStatus === "pending"}
					onModeChange={onModeChange}
				/>
				<div
					className="theme-surface-bg theme-border-color flex flex-col items-start gap-4 border p-6"
					role="status"
					aria-label={
						loosenStrictness
							? "No matches visible"
							: mode === "playlist"
								? "Playlist unavailable"
								: "Song unavailable"
					}
				>
					<p
						className="theme-text-muted text-sm"
						style={{ fontFamily: fonts.body }}
					>
						{itemData.message}
					</p>
					<div className="flex flex-wrap items-center gap-6">
						{loosenStrictness && (
							<Link
								to="/settings"
								hash="settings-section-matching"
								search={{ from: "match" }}
								className="theme-primary text-sm font-medium tracking-wide"
								style={{ fontFamily: fonts.body }}
							>
								Adjust strictness →
							</Link>
						)}
						<button
							type="button"
							onClick={handleSkipUnavailable}
							className={`text-sm font-medium tracking-wide ${
								loosenStrictness ? "theme-text-muted" : "theme-primary"
							}`}
							style={{ fontFamily: fonts.body }}
							disabled={navigationStatus === "pending"}
						>
							{skipLabel} →
						</button>
					</div>
				</div>
			</div>
		);
	}

	// Retryable-error card: a transient fetch failure. H7 copy is generic (not
	// mode-specific — the error is about loading the card, not the review item).
	// "Try again" refetches the authoritative card read without resolving the
	// item — retryable errors must never silently skip the card.
	if (itemData.status === "retryable-error") {
		const handleRetry = () => {
			queryClient.invalidateQueries({
				queryKey: readMatchDeckCardQueryOptions(itemId).queryKey,
			});
		};

		return (
			<div>
				<NonReadyCardHeader
					progressIndex={progressIndex}
					total={total}
					mode={mode}
					disabled={navigationStatus === "pending"}
					onModeChange={onModeChange}
				/>
				<div
					className="theme-surface-bg theme-border-color flex flex-col items-start gap-4 border p-6"
					role="status"
					aria-label="Card load error"
				>
					<p
						className="theme-text-muted text-sm"
						style={{ fontFamily: fonts.body }}
					>
						Couldn't load this match card. Try again.
					</p>
					<button
						type="button"
						onClick={handleRetry}
						className="theme-primary text-sm font-medium tracking-wide"
						style={{ fontFamily: fonts.body }}
					>
						Try again
					</button>
				</div>
			</div>
		);
	}

	const recordCurrentItem = () => {
		if (!currentReviewItem) return;
		const item =
			currentReviewItem.mode === "song"
				? {
						id: currentReviewItem.song.id,
						albumArtUrl: currentReviewItem.song.albumArtUrl,
						name: currentReviewItem.song.name,
						artist: currentReviewItem.song.artist,
					}
				: {
						id: currentReviewItem.playlist.id,
						albumArtUrl: currentReviewItem.playlist.imageUrl,
						name: currentReviewItem.playlist.name,
						artist: "",
					};
		sessionActions.recordPastItem(item);
	};

	// Add does NOT advance the card — user may add to multiple suggestions. The
	// mutation still locks navigation while the add decision is in flight so
	// Finish or Dismiss cannot resolve the item before the add row exists
	// (releaseOnSuccess: true on addSuggestionMutation covers that release; the
	// retryable-failure path — reconnect/spotify-error/rejected — also releases,
	// matching the old code's implicit "return without advancing").
	const handleAdd = async (suggestionId: string) => {
		if (!currentReviewItem) return;
		await addSuggestionMutation.run(suggestionId);
	};

	// No navigation lock here: the mutation's optimistic removal (+ rollback on
	// failure) is the interaction feedback, unlike add/whole-card dismiss/finish
	// which advance the card and must serialize against Previous/Next.
	const handleDismissSuggestion = async (suggestionId: string) => {
		if (!currentReviewItem) return;
		const success = await dismissSuggestion(suggestionId);
		if (!success) return;

		analytics.capture("match_suggestion_dismissed", {
			orientation: currentReviewItem.mode,
			suggestion_id: suggestionId,
		});
	};

	const handleDismiss = async () => {
		if (!currentReviewItem) return;
		if (currentReviewItem.mode === "song") {
			analytics.capture("song_dismissed", {
				song_id: currentReviewItem.song.id,
			});
		}
		await dismissCardMutation.run(undefined);
	};

	const handleNext = async () => {
		if (!currentReviewItem) return;
		await nextMutation.run(undefined);
	};

	const handlePrevious = () => {
		if (currentIndex === 0 || !sessionActions.lockNavigation()) return;
		sessionActions.clearAddedTo();
		// Best-effort: go back to the previous unresolved item. If it was resolved
		// externally since we last saw it, resolveCurrentItemId will fall back safely.
		sessionActions.advanceTo(unresolvedIds[currentIndex - 1] ?? null);
	};

	// X-of-Y is session progress, not a position in the navigable list: offset is
	// total − remaining so the numerator climbs (1 → 2 → 3) as cards resolve, while
	// totalSongs stays at the full session size. The denominator still grows softly
	// as new matches append, which is the intended "N new matches" behavior. Prev/Next
	// bounds stay in the navigable domain via currentIndex below.
	return (
		<Matching
			currentReviewItem={currentReviewItem}
			currentSuggestions={currentSuggestions}
			totalSongs={total}
			offset={progressIndex}
			addedTo={addedTo}
			isComplete={false}
			completionStats={completionStats}
			recentItems={pastItems}
			reconnectNeeded={reconnectNeeded}
			navigationDisabled={navigationStatus === "pending"}
			mode={mode}
			onModeChange={onModeChange}
			suggestionTotal={suggestionTotal}
			hasMoreSuggestions={hasMoreSuggestions}
			isLoadingMoreSuggestions={isLoadingMoreSuggestions}
			loadMoreSuggestions={loadMoreSuggestions}
			loadMoreError={loadMoreError}
			retryLoadMore={retryLoadMore}
			onAdd={handleAdd}
			onDismissSuggestion={handleDismissSuggestion}
			onDismiss={handleDismiss}
			onNext={handleNext}
			onPrevious={currentIndex > 0 ? handlePrevious : undefined}
			onExit={onExit}
		/>
	);
}
