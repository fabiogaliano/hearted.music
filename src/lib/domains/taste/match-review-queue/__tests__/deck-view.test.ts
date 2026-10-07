import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeDeckRpc, deckPlaylistCardRpc } from "@/test/fixtures";
import { ReadMatchDeckCardResultSchema } from "../deck-read-queries";
import {
	mapReadDeckCardToItemRead,
	mapStartOrResumeToView,
} from "../deck-view";

const mockAddBreadcrumb = vi.fn();
const mockCaptureException = vi.fn();

vi.mock("@sentry/cloudflare", () => ({
	captureException: (...args: unknown[]) => mockCaptureException(...args),
	addBreadcrumb: (...args: unknown[]) => mockAddBreadcrumb(...args),
}));

beforeEach(() => {
	vi.clearAllMocks();
});

const SONG_READY_RPC = {
	status: "ready" as const,
	song: {
		id: "song-1",
		spotify_id: "sp-song-1",
		name: "Song One",
		artists: ["The Artist", "Feat"],
		album_name: "The Album",
		image_url: "cover.jpg",
		genres: ["pop"],
		audio_feature: { tempo: 120, energy: 0.7, valence: 0.5 },
		analysis: null,
	},
	suggestions: [
		{
			playlist_id: "pl-1",
			name: "PL 1",
			match_intent: "intent-1",
			image_url: null,
			spotify_id: "sp-pl-1",
			song_count: 5,
			fit_score: 0.8,
			visible_rank: 1,
			model_rank: 1,
		},
		{
			playlist_id: "pl-2",
			name: "PL 2",
			match_intent: null,
			image_url: "pl2.jpg",
			spotify_id: "sp-pl-2",
			song_count: 8,
			fit_score: 0.7,
			visible_rank: 2,
			model_rank: 2,
		},
	],
	total_active_count: 2,
};

// ---------------------------------------------------------------------------
// mapReadDeckCardToItemRead
// ---------------------------------------------------------------------------

describe("mapReadDeckCardToItemRead", () => {
	it("maps a ready playlist card (subject + song suggestions), caps the total, no tail on a partial page", () => {
		const read = mapReadDeckCardToItemRead(
			deckPlaylistCardRpc(3, 3),
			"item-1",
			8,
			"playlist",
		);
		expect(read.status).toBe("ready");
		if (read.status !== "ready" || read.mode !== "playlist")
			throw new Error("bad");
		expect(read.reviewItem).toEqual({
			id: "pl-1",
			spotifyId: "sp-pl-1",
			name: "My Playlist",
			description: "chill",
			imageUrl: "img",
			trackCount: 10,
		});
		expect(read.suggestions).toHaveLength(3);
		expect(read.suggestions[0].song.artist).toBe("Artist 1");
		expect(read.suggestions[0].fitScore).toBeCloseTo(0.9);
		expect(read.suggestionTotal).toBe(3);
		// 3 rows < pageSize 8 → last page, no cursor.
		expect(read.nextCursor).toBeNull();
	});

	it("caps suggestionTotal at PLAYLIST_CARD_SUGGESTION_CAP and derives a tail cursor on a full page", () => {
		const read = mapReadDeckCardToItemRead(
			deckPlaylistCardRpc(8, 250),
			"item-1",
			8,
			"playlist",
		);
		if (read.status !== "ready" || read.mode !== "playlist")
			throw new Error("bad");
		// total 250 capped to 100.
		expect(read.suggestionTotal).toBe(100);
		// full page (8 === pageSize) and 8 < 100 → cursor from the last row.
		expect(read.nextCursor).toEqual({
			fitScore: read.suggestions[7].fitScore,
			modelRank: 8,
			songId: "song-8",
		});
	});

	it("maps a ready song card (song subject + playlist suggestions), nextCursor always null", () => {
		const read = mapReadDeckCardToItemRead(
			SONG_READY_RPC,
			"item-1",
			100,
			"song",
		);
		if (read.status !== "ready" || read.mode !== "song") throw new Error("bad");
		expect(read.reviewItem.artist).toBe("The Artist");
		expect(read.reviewItem.album).toBe("The Album");
		expect(read.reviewItem.albumArtUrl).toBe("cover.jpg");
		expect(read.reviewItem.audioFeatures).toEqual({
			tempo: 120,
			energy: 0.7,
			valence: 0.5,
		});
		expect(read.suggestions).toHaveLength(2);
		expect(read.suggestions[0].playlist).toEqual({
			id: "pl-1",
			name: "PL 1",
			description: "intent-1",
			trackCount: 5,
			imageUrl: null,
			spotifyId: "sp-pl-1",
		});
		expect(read.suggestions[0].score).toBe(0.8);
		expect(read.suggestions[0].rank).toBe(1);
		expect(read.suggestions[0].factors).toBeNull();
		expect(read.suggestionTotal).toBe(2);
		expect(read.nextCursor).toBeNull();
	});

	it.each([
		["not_found", "unavailable", "not-entitled"],
		["playlist_gone", "unavailable", "not-entitled"],
		["song_gone", "unavailable", "not-entitled"],
		["no_visible_suggestions", "unavailable", "no-visible-suggestions"],
		["not_captured", "retryable-error", undefined],
	])("maps the %s status", (status, expectedStatus, expectedReason) => {
		const read = mapReadDeckCardToItemRead(
			{ status } as never,
			"item-1",
			8,
			"playlist",
		);
		expect(read.status).toBe(expectedStatus);
		if (expectedReason && read.status === "unavailable") {
			expect(read.reason).toBe(expectedReason);
		}
	});

	it("uses orientation-aware no_visible_suggestions copy (legacy parity), generic when unknown", () => {
		// Legacy noVisibleSuggestionsMessage names the SUGGESTION side, not the
		// subject: a playlist card's missing matches are songs, and vice versa.
		const playlist = mapReadDeckCardToItemRead(
			{ status: "no_visible_suggestions" } as never,
			"item-1",
			8,
			"playlist",
		);
		if (playlist.status !== "unavailable") throw new Error("bad");
		expect(playlist.reason).toBe("no-visible-suggestions");
		expect(playlist.message).toBe(
			"No song matches are visible under your current settings.",
		);

		const song = mapReadDeckCardToItemRead(
			{ status: "no_visible_suggestions" } as never,
			"item-1",
			8,
			"song",
		);
		if (song.status !== "unavailable") throw new Error("bad");
		expect(song.message).toBe(
			"No playlist matches are visible under your current settings.",
		);

		// Standalone card GET can't derive orientation on this status → neutral copy.
		const unknown = mapReadDeckCardToItemRead(
			{ status: "no_visible_suggestions" } as never,
			"item-1",
			8,
			null,
		);
		if (unknown.status !== "unavailable") throw new Error("bad");
		expect(unknown.message).toBe(
			"No matches are visible under your current settings.",
		);
	});
});

// ---------------------------------------------------------------------------
// mapStartOrResumeToView — R-F snapshotId null coercion
// ---------------------------------------------------------------------------

describe("mapStartOrResumeToView", () => {
	it("maps an active view (progress, itemIds, current/next cards)", () => {
		const view = mapStartOrResumeToView(
			activeDeckRpc(deckPlaylistCardRpc(2, 2)),
			8,
		);
		expect(view.version).toBe(1);
		expect(view.orientation).toBe("playlist");
		expect(view.revision).toBe(3);
		expect(view.progress).toEqual({
			total: 5,
			remaining: 4,
			caughtUp: false,
			hiddenReviewItemCount: 1,
		});
		expect(view.itemIds).toEqual(["item-1", "item-2"]);
		expect(view.cards.current?.itemId).toBe("item-1");
		expect(view.cards.current?.presentation.status).toBe("ready");
		expect(view.cards.next).toBeNull();
	});

	it("coerces a null snapshotId to '' with a Sentry breadcrumb and never throws (R-F)", () => {
		const rpc = {
			...activeDeckRpc(deckPlaylistCardRpc(1, 1)),
			snapshotId: null,
		};
		const view = mapStartOrResumeToView(rpc, 8);
		expect(view.snapshotId).toBe("");
		expect(mockAddBreadcrumb).toHaveBeenCalledTimes(1);
		expect(mockAddBreadcrumb.mock.calls[0][0]).toMatchObject({
			category: "match_deck",
		});
	});
});

// ---------------------------------------------------------------------------
// captureUnexpectedCardShape — driven through mapStartOrResumeToView's call site
// (P1.1: the capture lives at the call site, not in the pure mapper). captureServerError
// funnels to Sentry.captureException, so the mocked captureException is the seam.
// ---------------------------------------------------------------------------

describe("mapStartOrResumeToView drift capture (captureUnexpectedCardShape)", () => {
	it("captures a ready card with no song/playlist subject and maps it to the retryable-error fallback", () => {
		const rpc = activeDeckRpc(
			ReadMatchDeckCardResultSchema.parse({ status: "ready" }),
		);

		const view = mapStartOrResumeToView(rpc, 8);

		expect(view.cards.current?.presentation.status).toBe("retryable-error");
		expect(mockCaptureException).toHaveBeenCalledTimes(1);
		expect(mockCaptureException.mock.calls[0][1]).toMatchObject({
			tags: { operation: "map_read_deck_card_to_item_read" },
			extra: { itemId: "item-1", status: "ready" },
		});
	});

	it("captures an unknown presentation status but the mapper still returns (retryable-error)", () => {
		const rpc = activeDeckRpc(
			ReadMatchDeckCardResultSchema.parse({ status: "renamed" }),
		);

		const view = mapStartOrResumeToView(rpc, 8);

		expect(view.cards.current?.presentation.status).toBe("retryable-error");
		expect(mockCaptureException).toHaveBeenCalledTimes(1);
		expect(mockCaptureException.mock.calls[0][1]).toMatchObject({
			tags: { operation: "map_read_deck_card_to_item_read" },
			extra: { itemId: "item-1", status: "renamed" },
		});
	});

	it("does NOT capture on not_captured (a known status the mapper handles as its cold path)", () => {
		const rpc = activeDeckRpc(
			ReadMatchDeckCardResultSchema.parse({ status: "not_captured" }),
		);

		const view = mapStartOrResumeToView(rpc, 8);

		expect(view.cards.current?.presentation.status).toBe("retryable-error");
		expect(mockCaptureException).not.toHaveBeenCalled();
	});
});
