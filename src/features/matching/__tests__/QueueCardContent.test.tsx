import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense } from "react";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { readMatchDeckCardQueryOptions } from "@/features/matching/deck-queries";
import { Matching } from "@/features/matching/Matching";
import { resetAuthFailedAtForTests } from "@/lib/extension/connection/auth-failed-store";
import {
	extensionConnectionKey,
	type PolledConnection,
} from "@/lib/extension/connection/connection-state";
import {
	reportSpotifyAuthFailure,
	reportSpotifyAuthSuccess,
} from "@/lib/extension/connection/report-failure";
import { resetUnreachableAtForTests } from "@/lib/extension/connection/unreachable-store";
import {
	getSpotifyAccountStatus,
	isExtensionInstalled,
} from "@/lib/extension/detect";
import { addToPlaylist } from "@/lib/extension/spotify-client";
import {
	readMatchDeckCard,
	submitMatchDeckAction,
} from "@/lib/server/match-deck.functions";
import { act, render, screen, waitFor } from "@/test/utils/render";
import { QueueCardContent } from "../QueueCardContent";

/**
 * Whole-card action handlers of QueueCardContent (M7, M9, N1 second half),
 * the shared-verdict wiring from 05-liked-songs-matching.md, and the
 * invariant-2 account-mismatch write block. Renders the real component tree
 * against a real QueryClient; only the server fns and the extension transport
 * are mocked.
 */

vi.mock("@/lib/server/match-deck.functions", () => ({
	submitMatchDeckAction: vi.fn(),
	readMatchDeckCard: vi.fn(),
	startOrResumeMatchDeck: vi.fn(),
}));

vi.mock("@/lib/extension/spotify-client", () => ({ addToPlaylist: vi.fn() }));

vi.mock("@/lib/extension/detect", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/extension/detect")>()),
	isExtensionInstalled: vi.fn(),
	getSpotifyAccountStatus: vi.fn(),
}));

// Pass-through spies: the real pushes still run, the tests only observe them.
vi.mock("@/lib/extension/connection/report-failure", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("@/lib/extension/connection/report-failure")
		>();
	return {
		...actual,
		reportSpotifyAuthFailure: vi.fn(actual.reportSpotifyAuthFailure),
		reportSpotifyAuthSuccess: vi.fn(actual.reportSpotifyAuthSuccess),
	};
});

// Pass-through spy so tests can read what QueueCardContent hands Matching and,
// for the mismatch gate, invoke onAdd the way a stale render's click would.
vi.mock("@/features/matching/Matching", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/features/matching/Matching")>();
	return { Matching: vi.fn(actual.Matching) };
});

vi.mock("@/lib/observability/sentry", () => ({ captureRouteError: vi.fn() }));

class ResizeObserverMock {
	observe = vi.fn();
	unobserve = vi.fn();
	disconnect = vi.fn();
}

beforeAll(() => {
	vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

const ACCOUNT_ID = "acct-1";
const LINKED_SPOTIFY_ID = "linked-1";
const DECK_KEY = ["match-deck", "deck", ACCOUNT_ID, "song"];
const cardKey = (itemId: string) => ["match-deck", "card", itemId, "read"];

const MISMATCH_PROFILE = {
	spotifyId: "wrong-id",
	displayName: "Someone Else",
	avatarUrl: null,
};

type ConnectionKind = "ok" | "spotify-disconnected" | "mismatch";

const CONNECTIONS: Record<ConnectionKind, PolledConnection> = {
	ok: {
		installed: true,
		spotifyConnected: true,
		paired: true,
		profile: {
			spotifyId: LINKED_SPOTIFY_ID,
			displayName: "Me",
			avatarUrl: null,
		},
	},
	"spotify-disconnected": {
		installed: true,
		spotifyConnected: false,
		paired: true,
		profile: {
			spotifyId: LINKED_SPOTIFY_ID,
			displayName: "Me",
			avatarUrl: null,
		},
	},
	mismatch: {
		installed: true,
		spotifyConnected: true,
		paired: true,
		profile: MISMATCH_PROFILE,
	},
};

const CHILL_SUGGESTION = {
	playlist: {
		id: "pl-1",
		spotifyId: "sp-pl-1",
		name: "Chill",
		description: null,
		trackCount: 10,
		imageUrl: null,
	},
	score: 0.9,
	rank: 1,
	factors: {},
};

function makeReadyItemData(itemId: string, withSuggestion: boolean) {
	return {
		status: "ready" as const,
		itemId,
		mode: "song" as const,
		reviewItem: {
			id: "song-1",
			spotifyId: "sp-song-1",
			name: "Test Song",
			artist: "Test Artist",
			album: null,
			albumArtUrl: null,
			genres: [],
			audioFeatures: null,
			analysis: null,
		},
		suggestions: withSuggestion ? [CHILL_SUGGESTION] : [],
		suggestionTotal: withSuggestion ? 1 : 0,
		nextCursor: null,
	};
}

function makeView(
	current: { itemId: string; status: "ready" | "retryable-error" },
	next: { itemId: string; status: "ready" } | null,
	total: number,
) {
	const card = (c: { itemId: string; status: string }, position: number) => ({
		itemId: c.itemId,
		position,
		presentation:
			c.status === "ready"
				? { status: "ready", itemId: c.itemId }
				: {
						status: "retryable-error",
						itemId: c.itemId,
						message: "Couldn't load this match card. Try again.",
					},
	});
	return {
		itemIds: [current.itemId, ...(next ? [next.itemId] : [])],
		cards: {
			current: card(current, 0),
			next: next ? card(next, 1) : null,
		},
		progress: {
			total,
			remaining: next ? 2 : 1,
			caughtUp: false,
			hiddenReviewItemCount: 0,
		},
	};
}

function makeSessionActions() {
	return {
		recordAddition: vi.fn(),
		clearAddedTo: vi.fn(),
		recordPastItem: vi.fn(),
		recordSkip: vi.fn(),
		recordDismissal: vi.fn(),
		advanceTo: vi.fn(),
		lockNavigation: vi.fn(() => true),
		releaseNavigation: vi.fn(),
	};
}

function renderCard({
	connection = "ok",
	withSuggestion = false,
}: {
	connection?: ConnectionKind;
	withSuggestion?: boolean;
} = {}) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	queryClient.setQueryData(
		readMatchDeckCardQueryOptions("item-1").queryKey,
		makeReadyItemData("item-1", withSuggestion) as never,
	);
	queryClient.setQueryData(extensionConnectionKey, CONNECTIONS[connection]);
	vi.mocked(isExtensionInstalled).mockResolvedValue(true);
	vi.mocked(getSpotifyAccountStatus).mockResolvedValue({
		connected: CONNECTIONS[connection].spotifyConnected,
		paired: true,
		profile: CONNECTIONS[connection].profile,
	});

	const sessionActions = makeSessionActions();
	const utils = render(
		<QueryClientProvider client={queryClient}>
			<Suspense fallback={null}>
				<QueueCardContent
					accountId={ACCOUNT_ID}
					itemId="item-1"
					currentIndex={0}
					total={1}
					mode="song"
					unresolvedIds={["item-1"]}
					addedTo={[]}
					navigationStatus="idle"
					pastItems={[]}
					completionStats={{
						totalItems: 1,
						itemsMatched: 0,
						totalAdditions: 0,
						dismissedCount: 0,
						skippedCount: 0,
					}}
					sessionActions={sessionActions}
					onModeChange={vi.fn()}
					onExit={vi.fn()}
					analytics={{ capture: vi.fn() } as never}
					queryClient={queryClient}
					linkedSpotifyId={LINKED_SPOTIFY_ID}
				/>
			</Suspense>
		</QueryClientProvider>,
	);

	// The mount effect releases navigation once for the landed card; the
	// assertions below are about what the action handlers do on top of that.
	sessionActions.releaseNavigation.mockClear();

	return {
		...utils,
		queryClient,
		sessionActions,
		cancelQueries: vi.spyOn(queryClient, "cancelQueries"),
		setQueryData: vi.spyOn(queryClient, "setQueryData"),
		prefetchQuery: vi.spyOn(queryClient, "prefetchQuery"),
		matchingProps: () => {
			const props = vi.mocked(Matching).mock.lastCall?.[0];
			if (!props) throw new Error("Matching was not rendered");
			return props;
		},
	};
}

const finishButton = () =>
	screen.getByRole("button", { name: /finish matching/i });
const addButton = () => screen.getByRole("button", { name: /^add$/i });

beforeEach(() => {
	vi.clearAllMocks();
	resetAuthFailedAtForTests();
	resetUnreachableAtForTests();
	vi.mocked(readMatchDeckCard).mockImplementation((async ({
		data,
	}: {
		data: { itemId: string };
	}) => ({ status: "ready", itemId: data.itemId })) as never);
});

afterEach(() => {
	resetAuthFailedAtForTests();
	resetUnreachableAtForTests();
});

describe("QueueCardContent whole-card action handlers", () => {
	describe("M7 — rejected finish-card reconciliation", () => {
		it("already_resolved applies result.view and does not bump session stats", async () => {
			const { user, sessionActions, setQueryData } = renderCard();
			const view = makeView({ itemId: "item-2", status: "ready" }, null, 2);
			vi.mocked(submitMatchDeckAction).mockResolvedValue({
				actionStatus: "already_resolved",
				view,
			} as never);

			await user.click(finishButton());
			await waitFor(() =>
				expect(sessionActions.advanceTo).toHaveBeenCalledWith("item-2"),
			);

			// The server's fresh view is authoritative — it must be applied to the
			// deck cache (M7), even though this call itself was rejected.
			expect(setQueryData).toHaveBeenCalledWith(DECK_KEY, view);
			// Not a real finish — this client didn't resolve the item (another
			// tab/session already did), so it must not count as a skip/finish.
			expect(sessionActions.recordSkip).not.toHaveBeenCalled();
			// Reconciling to the fresh view changes the itemId, which releases
			// navigation via the itemId-change effect once the parent re-renders —
			// this handler itself must not also call it explicitly.
			expect(sessionActions.releaseNavigation).not.toHaveBeenCalled();
		});

		it("no_captured_pairs releases navigation without applying the view", async () => {
			const { user, sessionActions, setQueryData } = renderCard();
			vi.mocked(submitMatchDeckAction).mockResolvedValue({
				actionStatus: "no_captured_pairs",
				view: makeView({ itemId: "item-1", status: "ready" }, null, 1),
			} as never);

			await user.click(finishButton());
			await waitFor(() =>
				expect(sessionActions.releaseNavigation).toHaveBeenCalledTimes(1),
			);

			// Transient/not-yet-captured (H4) — must NOT advance or apply the view;
			// releasing the lock lets the user retry.
			expect(setQueryData).not.toHaveBeenCalled();
			expect(sessionActions.advanceTo).not.toHaveBeenCalled();
			expect(sessionActions.recordSkip).not.toHaveBeenCalled();
		});
	});

	describe("N1 (second half) — applyResolvedView routes a promoted retryable-error card through prefetchQuery", () => {
		it("prefetches a promoted retryable-error card instead of seeding it into the card cache", async () => {
			const { user, sessionActions, setQueryData, prefetchQuery } =
				renderCard();
			const view = makeView(
				{ itemId: "item-2", status: "retryable-error" },
				{ itemId: "item-3", status: "ready" },
				3,
			);
			vi.mocked(submitMatchDeckAction).mockResolvedValue({
				actionStatus: "completed_added",
				view,
			} as never);

			await user.click(finishButton());
			await waitFor(() =>
				expect(sessionActions.advanceTo).toHaveBeenCalledWith("item-2"),
			);

			// The promoted current card is a transient retryable-error — must be
			// re-read through the authoritative card read (prefetchQuery), never
			// pinned into the long-lived card cache via setQueryData (mirrors the
			// loader-side test in match.test.ts).
			expect(prefetchQuery).toHaveBeenCalledWith(
				expect.objectContaining({ queryKey: cardKey("item-2") }),
			);
			expect(setQueryData).not.toHaveBeenCalledWith(
				cardKey("item-2"),
				expect.anything(),
			);
			// The promoted next card is ready — seeded normally.
			expect(setQueryData).toHaveBeenCalledWith(
				cardKey("item-3"),
				view.cards.next?.presentation,
			);
		});
	});

	describe("M9 — cancelQueries precedes the card-cache writes", () => {
		it("awaits cancelQueries on exactly the written card keys before any setQueryData call", async () => {
			const { user, sessionActions, cancelQueries, setQueryData } =
				renderCard();
			vi.mocked(submitMatchDeckAction).mockResolvedValue({
				actionStatus: "completed_added",
				view: makeView(
					{ itemId: "item-2", status: "ready" },
					{ itemId: "item-3", status: "ready" },
					3,
				),
			} as never);

			await user.click(finishButton());
			await waitFor(() =>
				expect(sessionActions.advanceTo).toHaveBeenCalledWith("item-2"),
			);

			// cancelQueries must only target the two card keys it's about to write —
			// never the deck key itself (no equivalent concurrent prefetcher there).
			expect(
				cancelQueries.mock.calls.map(
					(call) => (call[0] as { queryKey: unknown[] }).queryKey,
				),
			).toEqual([cardKey("item-2"), cardKey("item-3")]);

			// Ordering: every cancelQueries call must be invoked strictly before any
			// setQueryData call — the warm-ahead prefetch effect races these writes
			// (M9), so cancellation must land first.
			expect(Math.max(...cancelQueries.mock.invocationCallOrder)).toBeLessThan(
				Math.min(...setQueryData.mock.invocationCallOrder),
			);
		});
	});

	// 05-liked-songs-matching.md: the per-song useSpotifyReconnectState poll is
	// gone — reconnectNeeded now mirrors the shared connection verdict, and a
	// failed/successful add-to-playlist pushes into that shared state instead
	// of a local flag.
	describe("05 — shared connection verdict replaces per-song reconnect state", () => {
		it.each([
			["spotify-disconnected", true],
			["ok", false],
			// Mismatch gets its own signal (mismatchProfile) rather than reusing
			// reconnectNeeded: ReconnectPrompt's repair path is wrong for
			// "connected, just as the wrong person" (see useSpotifyGate.ts).
			["mismatch", false],
		] as const)("reconnectNeeded mirrors the shared verdict (%s → %s)", (connection, expected) => {
			const { matchingProps } = renderCard({ connection });
			expect(matchingProps().reconnectNeeded).toBe(expected);
		});

		it("pushes reportSpotifyAuthFailure on a reconnect-required Spotify outcome, and bails before the deck write", async () => {
			const { user, queryClient, sessionActions } = renderCard({
				withSuggestion: true,
			});
			vi.mocked(addToPlaylist).mockResolvedValue({
				ok: false,
				errorCode: "AUTH_REQUIRED",
			} as never);

			await user.click(addButton());
			await waitFor(() =>
				expect(sessionActions.releaseNavigation).toHaveBeenCalled(),
			);

			expect(reportSpotifyAuthFailure).toHaveBeenCalledWith(queryClient);
			expect(reportSpotifyAuthSuccess).not.toHaveBeenCalled();
			// Spotify write first, DB decision only on success — a reconnect bails
			// before submitting.
			expect(submitMatchDeckAction).not.toHaveBeenCalled();
		});

		it("pushes reportSpotifyAuthSuccess when the Spotify write itself comes back ok, then still submits the deck decision", async () => {
			const { user, queryClient, sessionActions } = renderCard({
				withSuggestion: true,
			});
			vi.mocked(addToPlaylist).mockResolvedValue({ ok: true } as never);
			vi.mocked(submitMatchDeckAction).mockResolvedValue({
				actionStatus: "added",
			} as never);

			await user.click(addButton());
			await waitFor(() =>
				expect(sessionActions.recordAddition).toHaveBeenCalled(),
			);

			expect(reportSpotifyAuthSuccess).toHaveBeenCalledWith(queryClient);
			expect(reportSpotifyAuthFailure).not.toHaveBeenCalled();
			expect(submitMatchDeckAction).toHaveBeenCalledWith({
				data: {
					type: "add-suggestion",
					itemId: "item-1",
					suggestionId: "pl-1",
				},
			});
		});

		it("a non-auth Spotify error neither pushes nor submits the deck decision", async () => {
			const { user, sessionActions } = renderCard({ withSuggestion: true });
			vi.mocked(addToPlaylist).mockResolvedValue({
				ok: false,
				errorCode: "INVALID_TARGET",
			} as never);

			await user.click(addButton());
			await waitFor(() =>
				expect(sessionActions.releaseNavigation).toHaveBeenCalled(),
			);

			expect(reportSpotifyAuthFailure).not.toHaveBeenCalled();
			expect(reportSpotifyAuthSuccess).not.toHaveBeenCalled();
			expect(submitMatchDeckAction).not.toHaveBeenCalled();
		});

		it("an extension-unavailable outcome bails before the deck write — no phantom resolved decision for a Spotify call that never happened", async () => {
			const { user, sessionActions } = renderCard({ withSuggestion: true });
			vi.mocked(addToPlaylist).mockResolvedValue({
				ok: false,
				errorCode: "NETWORK_ERROR",
			} as never);

			await user.click(addButton());
			await waitFor(() =>
				expect(sessionActions.releaseNavigation).toHaveBeenCalled(),
			);

			// No push either way: NETWORK_ERROR can't distinguish "extension
			// gone" from "extension fine, Spotify unreachable", so neither
			// sticky flag gets a trustworthy signal here.
			expect(reportSpotifyAuthFailure).not.toHaveBeenCalled();
			expect(reportSpotifyAuthSuccess).not.toHaveBeenCalled();
			expect(submitMatchDeckAction).not.toHaveBeenCalled();
		});
	});

	// Post-review fix (CRITICAL, invariant 2): phase 05 threaded a real
	// linkedSpotifyId into this hook, which made `mismatch` reachable here for
	// the first time — but nothing blocked the write under it. A mismatched
	// write would land on Spotify under whichever account the extension's live
	// token belongs to (not the deck's linked account) while this deck records
	// the decision as resolved. addSuggestion refuses the write outright under
	// `mismatch`, and Matching is handed `mismatchProfile` so the suggestion
	// sections render AccountMismatchPrompt instead of an Add button.
	describe("post-review fix — account mismatch blocks the write (CRITICAL, invariant 2)", () => {
		// The UI already hides Add under mismatch, so the gate is exercised the
		// way a stale render's click would reach it: through the onAdd handed to
		// Matching.
		async function addUnderMismatch() {
			const harness = renderCard({
				connection: "mismatch",
				withSuggestion: true,
			});
			// onAdd is typed void for Matching, so act can't await it; the
			// mutation's settle-time navigation release marks the async add done.
			act(() => {
				harness.matchingProps().onAdd("pl-1");
			});
			await waitFor(() =>
				expect(harness.sessionActions.releaseNavigation).toHaveBeenCalled(),
			);
			return harness;
		}

		it("never calls addToPlaylist or submits the deck decision, and neither push fires", async () => {
			await addUnderMismatch();

			expect(addToPlaylist).not.toHaveBeenCalled();
			expect(submitMatchDeckAction).not.toHaveBeenCalled();
			// A blocked write is not "the token failed" — it must not stamp a
			// fresh authFailedAt, and it must not clear a real sticky failure
			// either (no live command ran to evidence anything).
			expect(reportSpotifyAuthFailure).not.toHaveBeenCalled();
			expect(reportSpotifyAuthSuccess).not.toHaveBeenCalled();
		});

		it("blocks the write even when the Spotify command would have reported success (defense-in-depth: the gate, not the outcome, decides)", async () => {
			vi.mocked(addToPlaylist).mockResolvedValue({ ok: true } as never);
			vi.mocked(submitMatchDeckAction).mockResolvedValue({
				actionStatus: "added",
			} as never);

			const { sessionActions } = await addUnderMismatch();

			expect(addToPlaylist).not.toHaveBeenCalled();
			expect(submitMatchDeckAction).not.toHaveBeenCalled();
			expect(reportSpotifyAuthSuccess).not.toHaveBeenCalled();
			expect(sessionActions.recordAddition).not.toHaveBeenCalled();
		});

		it("hides Add and hands Matching the extension's live profile", () => {
			const { matchingProps } = renderCard({
				connection: "mismatch",
				withSuggestion: true,
			});

			expect(matchingProps().mismatchProfile).toEqual(MISMATCH_PROFILE);
			expect(screen.queryByRole("button", { name: /^add$/i })).toBeNull();
		});

		it.each([
			"ok",
			"spotify-disconnected",
		] as const)("mismatchProfile is null for the %s verdict", (connection) => {
			const { matchingProps } = renderCard({ connection });
			expect(matchingProps().mismatchProfile).toBeNull();
		});
	});
});
