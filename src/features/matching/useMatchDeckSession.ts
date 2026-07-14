/**
 * Match deck session state — extracted from QueueMatchContent (Deepening #2).
 * Owns the visit-local session state (current card pointer, added-to chips,
 * navigation lock, session stats, resolved-item history) behind a small,
 * domain-named action surface instead of raw setState dispatchers, matching
 * the {state, onAction} house style (see useDashboardSync).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { countAppendedFromTotal, resolveCurrentItemId } from "./queue-helpers";
import type { ReviewedItem } from "./types";

export interface MatchDeckSessionStats {
	addedCount: number;
	dismissedCount: number;
	skippedCount: number;
	songsWithAdditions: Set<string>;
}

export interface MatchDeckSessionState {
	/** Stable id pointer — resolved against the live itemIds list (id, not offset; see resolveCurrentItemId). */
	currentItemId: string | null;
	addedTo: string[];
	navigationStatus: "idle" | "pending";
	sessionStats: MatchDeckSessionStats;
	pastItems: ReviewedItem[];
}

export interface MatchDeckSessionActions {
	/** Records a successful add-to-playlist decision for the current card. */
	recordAddition: (suggestionId: string, statKey?: string) => void;
	/** Clears the current card's added-to chips (dismiss/finish/previous). */
	clearAddedTo: () => void;
	/** Adds the current review item to the resolved-items history (dedup by id). */
	recordPastItem: (item: ReviewedItem) => void;
	/** Bumps the skipped counter (unavailable-card skip, or finish with no adds). */
	recordSkip: () => void;
	/** Bumps the dismissed counter. */
	recordDismissal: () => void;
	/** Moves the tracked current-item pointer (promoted card, or Previous). */
	advanceTo: (itemId: string | null) => void;
	/** Claims the navigation lock; returns false if already locked. */
	lockNavigation: () => boolean;
	/** Releases the navigation lock. */
	releaseNavigation: () => void;
}

export interface UseMatchDeckSessionResult {
	state: MatchDeckSessionState;
	actions: MatchDeckSessionActions;
	/** Derived: the tracked id resolved against the live itemIds list, falling back safely if it dropped out. */
	resolvedCurrentItemId: string | null;
}

/**
 * `total` drives the passive "N new matches added" chip (fires when the
 * append-only deck total grows). `initialItemId` seeds the pointer from the
 * deck view's baked current card.
 */
export function useMatchDeckSession(
	itemIds: string[],
	total: number,
	initialItemId: string | null,
): UseMatchDeckSessionResult {
	const [currentItemId, setCurrentItemId] = useState<string | null>(
		() => initialItemId,
	);
	const [addedTo, setAddedTo] = useState<string[]>([]);
	const [navigationStatus, setNavigationStatus] = useState<"idle" | "pending">(
		"idle",
	);
	// Ref so lock checks inside async handlers don't close over stale state.
	const navigationLockedRef = useRef(false);

	const [sessionStats, setSessionStats] = useState<MatchDeckSessionStats>(
		() => ({
			addedCount: 0,
			dismissedCount: 0,
			skippedCount: 0,
			songsWithAdditions: new Set<string>(),
		}),
	);

	const [pastItems, setPastItems] = useState<ReviewedItem[]>([]);

	// Passive chip: fire when the deck total grows. Using total (append-only from
	// the server) rather than itemIds.length means a head-drop + tail-append that
	// nets zero on length still surfaces the new-items notification.
	const prevTotalRef = useRef(total);
	useEffect(() => {
		const prev = prevTotalRef.current;
		prevTotalRef.current = total;

		const added = countAppendedFromTotal(prev, total);
		if (added > 0) {
			toast(`${added} new ${added === 1 ? "match" : "matches"} added`, {
				duration: 3000,
			});
		}
	}, [total]);

	// Resolve the stable current item: if the tracked id dropped from the deck's
	// unresolved list (resolved via an action) fall back to the first unresolved
	// rather than crash.
	const resolvedCurrentItemId = resolveCurrentItemId(itemIds, currentItemId);

	const recordAddition = useCallback(
		(suggestionId: string, statKey?: string) => {
			setAddedTo((prev) => [...prev, suggestionId]);
			setSessionStats((prev) => {
				const next = new Set(prev.songsWithAdditions);
				if (statKey) next.add(statKey);
				return {
					...prev,
					addedCount: prev.addedCount + 1,
					songsWithAdditions: next,
				};
			});
		},
		[],
	);

	const clearAddedTo = useCallback(() => setAddedTo([]), []);

	const recordPastItem = useCallback((item: ReviewedItem) => {
		setPastItems((prev) => {
			if (prev.some((s) => s.id === item.id)) return prev;
			return [...prev, item];
		});
	}, []);

	const recordSkip = useCallback(() => {
		setSessionStats((prev) => ({
			...prev,
			skippedCount: prev.skippedCount + 1,
		}));
	}, []);

	const recordDismissal = useCallback(() => {
		setSessionStats((prev) => ({
			...prev,
			dismissedCount: prev.dismissedCount + 1,
		}));
	}, []);

	const advanceTo = useCallback((itemId: string | null) => {
		setCurrentItemId(itemId);
	}, []);

	// Stable identities so the child's release-on-mount effect runs exactly once
	// per card. Both only touch a ref + a stable setState, so empty deps are safe.
	const lockNavigation = useCallback(() => {
		if (navigationLockedRef.current) return false;
		navigationLockedRef.current = true;
		setNavigationStatus("pending");
		return true;
	}, []);
	const releaseNavigation = useCallback(() => {
		navigationLockedRef.current = false;
		setNavigationStatus("idle");
	}, []);

	return {
		state: {
			currentItemId,
			addedTo,
			navigationStatus,
			sessionStats,
			pastItems,
		},
		actions: {
			recordAddition,
			clearAddedTo,
			recordPastItem,
			recordSkip,
			recordDismissal,
			advanceTo,
			lockNavigation,
			releaseNavigation,
		},
		resolvedCurrentItemId,
	};
}
