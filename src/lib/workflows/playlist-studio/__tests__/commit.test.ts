/**
 * Tests for the draft→Spotify commit workflow: runPersistNewPlaylistConfig
 * and runRecordPlaylistMatchDecisions.
 *
 * DB-touching collaborators are mocked (per the scheduler.test.ts idiom);
 * intent-eligibility, match-filter parsing/normalizing, and genre-pill
 * sanitizing stay real (pure logic, cheap, and worth exercising for real
 * given the AND-gate and fail-closed guarantees under test here).
 *
 * The two functions get their own fixtures throughout — each has its own
 * ownership re-check by design (defense in depth), so sharing setup between
 * them would blur that boundary.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSupabaseClient } from "@/lib/data/client";
import { makeBillingState } from "@/lib/domains/billing/fixtures";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import type { Song } from "@/lib/domains/library/songs/queries";
import { DatabaseError } from "@/lib/shared/errors/database";

const readBillingStateOrFreeTierMock = vi.fn();
vi.mock("@/lib/domains/billing/queries", () => ({
	readBillingStateOrFreeTier: (...args: unknown[]) =>
		readBillingStateOrFreeTierMock(...args),
}));

const selectOwnedSongIdsMock = vi.fn();
vi.mock("@/lib/domains/library/liked-songs/queries", () => ({
	selectOwnedSongIds: (...args: unknown[]) => selectOwnedSongIdsMock(...args),
}));

const getPlaylistBySpotifyIdMock = vi.fn();
const updatePlaylistMatchConfigMock = vi.fn();
vi.mock("@/lib/domains/library/playlists/queries", () => ({
	getPlaylistBySpotifyId: (...args: unknown[]) =>
		getPlaylistBySpotifyIdMock(...args),
	updatePlaylistMatchConfig: (...args: unknown[]) =>
		updatePlaylistMatchConfigMock(...args),
}));

const getSongsByIdsMock = vi.fn();
vi.mock("@/lib/domains/library/songs/queries", () => ({
	getByIds: (...args: unknown[]) => getSongsByIdsMock(...args),
}));

const upsertMatchDecisionsMock = vi.fn();
vi.mock("@/lib/domains/taste/song-matching/decision-queries", () => ({
	upsertMatchDecisions: (...args: unknown[]) =>
		upsertMatchDecisionsMock(...args),
}));

import {
	runPersistNewPlaylistConfig,
	runRecordPlaylistMatchDecisions,
} from "../commit";

const fakeSupabase = {} as AdminSupabaseClient;

function makePlaylist(overrides: Partial<Playlist> = {}): Playlist {
	return {
		id: "playlist-uuid-1",
		account_id: "acct-1",
		spotify_id: "abc123",
		name: "Test Playlist",
		description: null,
		match_intent: null,
		match_filters: { version: 1 },
		snapshot_id: null,
		is_public: true,
		song_count: 0,
		is_target: false,
		image_url: null,
		genre_pills: [],
		created_at: "2026-03-28T00:00:00Z",
		updated_at: "2026-03-28T00:00:00Z",
		...overrides,
	};
}

function makeSong(id: string, overrides: Partial<Song> = {}): Song {
	return {
		id,
		spotify_id: `sp-${id}`,
		name: `Song ${id}`,
		artists: ["Artist"],
		...overrides,
	} as Song;
}

describe("runPersistNewPlaylistConfig", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getPlaylistBySpotifyIdMock.mockResolvedValue(Result.ok(makePlaylist()));
		updatePlaylistMatchConfigMock.mockResolvedValue(Result.ok(makePlaylist()));
		readBillingStateOrFreeTierMock.mockResolvedValue(makeBillingState());
		getSongsByIdsMock.mockResolvedValue(Result.ok([]));
		selectOwnedSongIdsMock.mockResolvedValue(Result.ok(new Set<string>()));
	});

	function baseInput(
		overrides: Partial<Parameters<typeof runPersistNewPlaylistConfig>[2]> = {},
	) {
		return {
			spotifyId: "abc123",
			songIds: [] as string[],
			intent: null,
			genrePills: [] as string[],
			matchFilters: { version: 1 as const },
			intentApplied: false,
			...overrides,
		};
	}

	it("throws when the playlist lookup errors", async () => {
		getPlaylistBySpotifyIdMock.mockResolvedValue(
			Result.err(new DatabaseError({ code: "PGRST", message: "db down" })),
		);

		await expect(
			runPersistNewPlaylistConfig(fakeSupabase, "acct-1", baseInput()),
		).rejects.toThrow("Failed to look up playlist");
	});

	it("throws when no playlist is found", async () => {
		getPlaylistBySpotifyIdMock.mockResolvedValue(Result.ok(null));

		await expect(
			runPersistNewPlaylistConfig(fakeSupabase, "acct-1", baseInput()),
		).rejects.toThrow("Playlist not found");
	});

	it("throws when the playlist belongs to a different account", async () => {
		getPlaylistBySpotifyIdMock.mockResolvedValue(
			Result.ok(makePlaylist({ account_id: "acct-other" })),
		);

		await expect(
			runPersistNewPlaylistConfig(fakeSupabase, "acct-1", baseInput()),
		).rejects.toThrow("Playlist not found");
		expect(updatePlaylistMatchConfigMock).not.toHaveBeenCalled();
	});

	it("drops intent when the account is ineligible despite intentApplied: true", async () => {
		readBillingStateOrFreeTierMock.mockResolvedValue(
			makeBillingState({ unlimitedAccess: { kind: "none" } }),
		);

		await runPersistNewPlaylistConfig(
			fakeSupabase,
			"acct-1",
			baseInput({ intent: "mellow winter mornings", intentApplied: true }),
		);

		expect(updatePlaylistMatchConfigMock).toHaveBeenCalledWith(
			"acct-1",
			"playlist-uuid-1",
			expect.objectContaining({ matchIntent: null }),
		);
	});

	it("drops intent when eligible but intentApplied: false", async () => {
		readBillingStateOrFreeTierMock.mockResolvedValue(
			makeBillingState({ unlimitedAccess: { kind: "subscription" } }),
		);

		await runPersistNewPlaylistConfig(
			fakeSupabase,
			"acct-1",
			baseInput({ intent: "mellow winter mornings", intentApplied: false }),
		);

		expect(updatePlaylistMatchConfigMock).toHaveBeenCalledWith(
			"acct-1",
			"playlist-uuid-1",
			expect.objectContaining({ matchIntent: null }),
		);
	});

	it("persists intent when eligible AND intentApplied: true", async () => {
		readBillingStateOrFreeTierMock.mockResolvedValue(
			makeBillingState({ unlimitedAccess: { kind: "subscription" } }),
		);

		await runPersistNewPlaylistConfig(
			fakeSupabase,
			"acct-1",
			baseInput({ intent: "mellow winter mornings", intentApplied: true }),
		);

		expect(updatePlaylistMatchConfigMock).toHaveBeenCalledWith(
			"acct-1",
			"playlist-uuid-1",
			expect.objectContaining({ matchIntent: "mellow winter mornings" }),
		);
	});

	it("fails closed on ownership-lookup error: empty trackUris, no throw, never trusts caller ids", async () => {
		selectOwnedSongIdsMock.mockResolvedValue(
			Result.err(new DatabaseError({ code: "PGRST", message: "timeout" })),
		);
		getSongsByIdsMock.mockResolvedValue(
			Result.ok([makeSong("s1"), makeSong("s2")]),
		);

		const result = await runPersistNewPlaylistConfig(
			fakeSupabase,
			"acct-1",
			baseInput({ songIds: ["s1", "s2"] }),
		);

		expect(result.trackUris).toEqual([]);
		expect(result.playlistId).toBe("playlist-uuid-1");
	});

	it("silently drops non-owned ids from the URI list and preserves caller order", async () => {
		getSongsByIdsMock.mockResolvedValue(
			Result.ok([makeSong("s1"), makeSong("s2"), makeSong("s3")]),
		);
		selectOwnedSongIdsMock.mockResolvedValue(Result.ok(new Set(["s1", "s3"])));

		const result = await runPersistNewPlaylistConfig(
			fakeSupabase,
			"acct-1",
			baseInput({ songIds: ["s1", "s2", "s3"] }),
		);

		expect(result.trackUris).toEqual([
			"spotify:track:sp-s1",
			"spotify:track:sp-s3",
		]);
	});

	it("returns empty trackUris (no throw) when getSongsByIds errors", async () => {
		getSongsByIdsMock.mockResolvedValue(
			Result.err(new DatabaseError({ code: "PGRST", message: "db down" })),
		);
		selectOwnedSongIdsMock.mockResolvedValue(Result.ok(new Set(["s1"])));

		const result = await runPersistNewPlaylistConfig(
			fakeSupabase,
			"acct-1",
			baseInput({ songIds: ["s1"] }),
		);

		expect(result.trackUris).toEqual([]);
	});

	it("throws on invalid match filters before any write", async () => {
		await expect(
			runPersistNewPlaylistConfig(
				fakeSupabase,
				"acct-1",
				baseInput({
					matchFilters: {
						version: 1,
						languages: { codes: ["xx-invented"] },
					},
				}),
			),
		).rejects.toThrow("Invalid match filters");
		expect(updatePlaylistMatchConfigMock).not.toHaveBeenCalled();
	});
});

describe("runRecordPlaylistMatchDecisions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getPlaylistBySpotifyIdMock.mockResolvedValue(Result.ok(makePlaylist()));
		selectOwnedSongIdsMock.mockResolvedValue(Result.ok(new Set<string>()));
		upsertMatchDecisionsMock.mockResolvedValue(Result.ok([]));
	});

	it("returns recorded: 0 without any lookups when songIds is empty", async () => {
		const result = await runRecordPlaylistMatchDecisions("acct-1", {
			spotifyId: "abc123",
			songIds: [],
		});

		expect(result).toEqual({ recorded: 0 });
		expect(getPlaylistBySpotifyIdMock).not.toHaveBeenCalled();
	});

	it("throws when the playlist lookup fails", async () => {
		getPlaylistBySpotifyIdMock.mockResolvedValue(
			Result.err(new DatabaseError({ code: "PGRST", message: "db down" })),
		);

		await expect(
			runRecordPlaylistMatchDecisions("acct-1", {
				spotifyId: "abc123",
				songIds: ["s1"],
			}),
		).rejects.toThrow("Playlist not found for match decision recording");
	});

	it("throws when the playlist is not found", async () => {
		getPlaylistBySpotifyIdMock.mockResolvedValue(Result.ok(null));

		await expect(
			runRecordPlaylistMatchDecisions("acct-1", {
				spotifyId: "abc123",
				songIds: ["s1"],
			}),
		).rejects.toThrow("Playlist not found for match decision recording");
	});

	it("throws when the ownership lookup fails", async () => {
		selectOwnedSongIdsMock.mockResolvedValue(
			Result.err(new DatabaseError({ code: "PGRST", message: "timeout" })),
		);

		await expect(
			runRecordPlaylistMatchDecisions("acct-1", {
				spotifyId: "abc123",
				songIds: ["s1"],
			}),
		).rejects.toThrow(
			"Failed to verify song ownership for match decision recording",
		);
	});

	it("filters non-owned ids before upserting", async () => {
		selectOwnedSongIdsMock.mockResolvedValue(Result.ok(new Set(["s1"])));
		upsertMatchDecisionsMock.mockResolvedValue(
			Result.ok([{ id: "decision-1" }]),
		);

		const result = await runRecordPlaylistMatchDecisions("acct-1", {
			spotifyId: "abc123",
			songIds: ["s1", "s2"],
		});

		expect(upsertMatchDecisionsMock).toHaveBeenCalledWith([
			expect.objectContaining({ songId: "s1", playlistId: "playlist-uuid-1" }),
		]);
		expect(result).toEqual({ recorded: 1 });
	});

	it("returns recorded: 0 and skips the upsert call when none of the ids are owned", async () => {
		selectOwnedSongIdsMock.mockResolvedValue(Result.ok(new Set<string>()));

		const result = await runRecordPlaylistMatchDecisions("acct-1", {
			spotifyId: "abc123",
			songIds: ["s1", "s2"],
		});

		expect(result).toEqual({ recorded: 0 });
		expect(upsertMatchDecisionsMock).not.toHaveBeenCalled();
	});

	it("throws when the upsert fails", async () => {
		selectOwnedSongIdsMock.mockResolvedValue(Result.ok(new Set(["s1"])));
		upsertMatchDecisionsMock.mockResolvedValue(
			Result.err(new DatabaseError({ code: "PGRST", message: "write failed" })),
		);

		await expect(
			runRecordPlaylistMatchDecisions("acct-1", {
				spotifyId: "abc123",
				songIds: ["s1"],
			}),
		).rejects.toThrow("Failed to record match decisions");
	});
});
