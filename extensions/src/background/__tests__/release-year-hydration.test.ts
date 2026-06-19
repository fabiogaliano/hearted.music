import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpotifyTrackDTO } from "../../shared/types";

// Prefixed with `mock` so vitest's hoisted vi.mock factory may reference it.
const mockGetTrack = vi.fn();
vi.mock("../../shared/spotify-client/reads", () => ({
	getTrack: (...args: unknown[]) => mockGetTrack(...args),
}));

import {
	attachReleaseYearsToTracks,
	fetchIdsNeedingLookup,
	fetchReleaseYears,
	hydrateLikedSongReleaseYears,
	markReleaseYearCheckedOnTracks,
	type PostToBackend,
	recordReleaseYearLookups,
	selectLikedTracksMissingReleaseYear,
} from "../release-year-hydration";

function makeLiked(id: string, releaseYear?: number | null): SpotifyTrackDTO {
	return {
		added_at: "2026-06-01T00:00:00.000Z",
		track: {
			id,
			name: `Track ${id}`,
			artists: [{ id: "a1", name: "Artist" }],
			album: { id: "alb", name: "Album", images: [] },
			duration_ms: 1000,
			uri: `spotify:track:${id}`,
			...(releaseYear === undefined ? {} : { release_year: releaseYear }),
		},
	};
}

/** A postToBackend stub that records calls and replies per-path with JSON. */
function stubBackend(
	responder: (path: string, body: Record<string, unknown>) => unknown,
): { post: PostToBackend; calls: Array<{ path: string; body: unknown }> } {
	const calls: Array<{ path: string; body: unknown }> = [];
	const post: PostToBackend = async (path, body) => {
		calls.push({ path, body });
		return new Response(JSON.stringify(responder(path, body)), { status: 200 });
	};
	return { post, calls };
}

beforeEach(() => vi.clearAllMocks());

describe("selectLikedTracksMissingReleaseYear", () => {
	it("keeps only songs without a year that aren't covered by playlist sync", () => {
		const tracks = [
			makeLiked("a"),
			makeLiked("b", 2000),
			makeLiked("c"),
			makeLiked("d"),
		];
		const selected = selectLikedTracksMissingReleaseYear(
			tracks,
			new Set(["d"]),
		);
		expect(selected.map((t) => t.track.id)).toEqual(["a", "c"]);
	});
});

describe("fetchIdsNeedingLookup", () => {
	it("returns the backend's needsLookup set", async () => {
		const { post, calls } = stubBackend(() => ({ needsLookup: ["a", "c"] }));
		const needs = await fetchIdsNeedingLookup(post, ["a", "b", "c"]);
		expect([...needs].sort()).toEqual(["a", "c"]);
		expect(calls[0].path).toBe("/api/extension/release-year/pending");
		expect(calls[0].body).toEqual({ spotifyIds: ["a", "b", "c"] });
	});

	it("is best-effort: a non-OK response yields an empty set (skip hydration)", async () => {
		const post: PostToBackend = async () =>
			new Response("nope", { status: 500 });
		expect((await fetchIdsNeedingLookup(post, ["a"])).size).toBe(0);
	});
});

describe("fetchReleaseYears", () => {
	it("resolves years, records every response as a lookup, and skips transient failures", async () => {
		const reader = vi.fn(async (_token: string, uri: string) => {
			if (uri.endsWith("err")) throw new Error("network");
			if (uri.endsWith("noyear")) return { releaseYear: null };
			return { releaseYear: 1999 };
		});

		const { resolved, lookups } = await fetchReleaseYears(
			"tok",
			[makeLiked("ok"), makeLiked("noyear"), makeLiked("err")],
			reader,
			2,
		);

		expect(resolved.get("ok")).toBe(1999);
		expect(resolved.has("noyear")).toBe(false);
		// A response (even "no year") becomes a lookup so the backend stamps it;
		// a thrown (transient) one is omitted so a later sync retries it.
		const byId = new Map(lookups.map((l) => [l.spotifyId, l.releaseYear]));
		expect(byId.get("ok")).toBe(1999);
		expect(byId.get("noyear")).toBeNull();
		expect(byId.has("err")).toBe(false);
	});
});

describe("attachReleaseYearsToTracks", () => {
	it("immutably writes only resolved years", () => {
		const tracks = [makeLiked("a"), makeLiked("b")];
		const out = attachReleaseYearsToTracks(tracks, new Map([["a", 2010]]));

		expect(out[0].track.release_year).toBe(2010);
		expect(out[1].track.release_year).toBeUndefined();
		expect(out[0]).not.toBe(tracks[0]);
		expect(tracks[0].track.release_year).toBeUndefined();
	});
});

describe("recordReleaseYearLookups", () => {
	it("posts completed lookups to the checked endpoint", async () => {
		const { post, calls } = stubBackend(() => ({ ok: true, updated: 1 }));
		await recordReleaseYearLookups(post, [
			{ spotifyId: "a", releaseYear: 1990 },
		]);
		expect(calls[0].path).toBe("/api/extension/release-year/checked");
		expect(calls[0].body).toEqual({
			lookups: [{ spotifyId: "a", releaseYear: 1990 }],
		});
	});

	it("throws when the checked endpoint responds non-OK", async () => {
		const post: PostToBackend = async () =>
			new Response("db down", { status: 500 });
		await expect(
			recordReleaseYearLookups(post, [{ spotifyId: "a", releaseYear: null }]),
		).rejects.toThrow(/HTTP 500/i);
	});

	it("no-ops on an empty lookup set", async () => {
		const { post, calls } = stubBackend(() => ({}));
		await recordReleaseYearLookups(post, []);
		expect(calls).toHaveLength(0);
	});
});

describe("markReleaseYearCheckedOnTracks", () => {
	it("marks every completed lookup as checked, even when Spotify returned no year", () => {
		const tracks = [makeLiked("a"), makeLiked("b")];
		const out = markReleaseYearCheckedOnTracks(tracks, [
			{ spotifyId: "a", releaseYear: 1990 },
			{ spotifyId: "b", releaseYear: null },
		]);
		expect(out[0].track.release_year_checked).toBe(true);
		expect(out[1].track.release_year_checked).toBe(true);
		expect(tracks[0].track.release_year_checked).toBeUndefined();
	});
});

describe("hydrateLikedSongReleaseYears", () => {
	it("only fetches the ids the backend says still need a lookup", async () => {
		mockGetTrack.mockImplementation(async (_t: string, uri: string) => ({
			releaseYear: uri.endsWith("a") ? 1990 : 1995,
		}));
		// Backend has already resolved/checked "b"; only "a" needs a lookup.
		const { post } = stubBackend(() => ({ needsLookup: ["a"] }));

		const { likedSongs, lookups } = await hydrateLikedSongReleaseYears(
			"tok",
			[makeLiked("a"), makeLiked("b")],
			new Set(),
			post,
		);

		expect(mockGetTrack).toHaveBeenCalledTimes(1);
		expect(mockGetTrack).toHaveBeenCalledWith("tok", "spotify:track:a");
		expect(likedSongs.find((t) => t.track.id === "a")?.track.release_year).toBe(
			1990,
		);
		expect(
			likedSongs.find((t) => t.track.id === "a")?.track.release_year_checked,
		).toBe(true);
		expect(
			likedSongs.find((t) => t.track.id === "b")?.track.release_year,
		).toBeUndefined();
		expect(
			likedSongs.find((t) => t.track.id === "b")?.track.release_year_checked,
		).toBeUndefined();
		expect(lookups).toEqual([{ spotifyId: "a", releaseYear: 1990 }]);
	});

	it("excludes playlist-covered songs from the pending check entirely", async () => {
		mockGetTrack.mockResolvedValue({ releaseYear: 1999 });
		const { post, calls } = stubBackend((path) =>
			path.endsWith("/pending") ? { needsLookup: ["liked-only"] } : {},
		);

		await hydrateLikedSongReleaseYears(
			"tok",
			[makeLiked("playlist-overlap"), makeLiked("liked-only")],
			new Set(["playlist-overlap"]),
			post,
		);

		const pending = calls.find((c) => c.path.endsWith("/pending"));
		// playlist-overlap never reaches the backend, so it can't consume budget.
		expect(pending?.body).toEqual({ spotifyIds: ["liked-only"] });
	});

	it("does nothing without a postToBackend (DB is the source of truth)", async () => {
		const input = [makeLiked("a")];
		const result = await hydrateLikedSongReleaseYears("tok", input, new Set());
		expect(result.likedSongs).toBe(input);
		expect(result.lookups).toEqual([]);
		expect(mockGetTrack).not.toHaveBeenCalled();
	});

	it("is best-effort: a failed pending check returns the input unchanged", async () => {
		const post: PostToBackend = async () => new Response("x", { status: 500 });
		const input = [makeLiked("z")];
		const { likedSongs, lookups } = await hydrateLikedSongReleaseYears(
			"tok",
			input,
			new Set(),
			post,
		);
		expect(likedSongs).toBe(input);
		expect(lookups).toEqual([]);
		expect(mockGetTrack).not.toHaveBeenCalled();
	});
});
