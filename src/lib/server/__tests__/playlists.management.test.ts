import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import type { Song } from "@/lib/domains/library/songs/queries";
import { DatabaseError } from "@/lib/shared/errors/database";
import { PlaylistManagementChanges } from "@/lib/workflows/library-processing/changes/playlist-management";
import type { LibraryProcessingApplyOutcome } from "@/lib/workflows/library-processing/types";
import {
	flushPlaylistManagementSession,
	getPlaylistManagementData,
	getPlaylistTracksPage,
	savePlaylistGenrePills,
	setPlaylistTargetMutation,
} from "../playlists.functions";

const {
	mockAuthContext,
	mockGetPlaylists,
	mockGetTargetPlaylists,
	mockGetPlaylistById,
	mockGetPlaylistSongsPage,
	mockGetSongsByIds,
	mockSetPlaylistTarget,
	mockApplyLibraryProcessingChange,
	mockUpdatePlaylistGenrePills,
	mockSyncActiveQueue,
	mockHasFirstVisibleReviewSubject,
	mockCaptureWithWaitUntil,
} = vi.hoisted(() => ({
	mockAuthContext: {
		session: { accountId: "acct-1" },
		account: null,
	},
	mockGetPlaylists: vi.fn(),
	mockGetTargetPlaylists: vi.fn(),
	mockGetPlaylistById: vi.fn(),
	mockGetPlaylistSongsPage: vi.fn(),
	mockGetSongsByIds: vi.fn(),
	mockSetPlaylistTarget: vi.fn(),
	mockApplyLibraryProcessingChange: vi.fn(),
	mockUpdatePlaylistGenrePills: vi.fn(),
	mockSyncActiveQueue: vi.fn(),
	mockHasFirstVisibleReviewSubject: vi.fn(),
	mockCaptureWithWaitUntil: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tanstack/react-start", () => {
	const builder = (): Record<string, unknown> => ({
		middleware: () => builder(),
		inputValidator: () => builder(),
		handler:
			(
				fn: (args: {
					context: typeof mockAuthContext;
					data: unknown;
				}) => unknown,
			) =>
			(input?: { data?: unknown }) =>
				fn({ context: mockAuthContext, data: input?.data }),
	});
	return {
		createServerFn: builder,
		createMiddleware: () => ({
			server: () => ({}),
			type: () => ({ server: () => ({}) }),
		}),
	};
});

vi.mock("@/lib/domains/library/playlists/queries", () => ({
	upsertPlaylists: vi.fn(),
	getPlaylists: (...args: unknown[]) => mockGetPlaylists(...args),
	getTargetPlaylists: (...args: unknown[]) => mockGetTargetPlaylists(...args),
	getPlaylistById: (...args: unknown[]) => mockGetPlaylistById(...args),
	getPlaylistBySpotifyId: vi.fn(),
	getPlaylistSongsPage: (...args: unknown[]) =>
		mockGetPlaylistSongsPage(...args),
	deletePlaylist: vi.fn(),
	setPlaylistTarget: (...args: unknown[]) => mockSetPlaylistTarget(...args),
	updatePlaylistMetadata: vi.fn(),
	updatePlaylistGenrePills: (...args: unknown[]) =>
		mockUpdatePlaylistGenrePills(...args),
}));

vi.mock("@/lib/domains/library/songs/queries", () => ({
	getByIds: (...args: unknown[]) => mockGetSongsByIds(...args),
}));

vi.mock("@/lib/workflows/library-processing/service", () => ({
	applyLibraryProcessingChange: (...args: unknown[]) =>
		mockApplyLibraryProcessingChange(...args),
}));

vi.mock("@/lib/domains/taste/match-review-queue/service", () => ({
	syncActiveQueue: (...args: unknown[]) => mockSyncActiveQueue(...args),
	hasFirstVisibleReviewSubject: (...args: unknown[]) =>
		mockHasFirstVisibleReviewSubject(...args),
}));

vi.mock("@/utils/posthog-server", () => ({
	captureWithWaitUntil: (...args: unknown[]) =>
		mockCaptureWithWaitUntil(...args),
}));

function makePlaylist(overrides: Partial<Playlist> = {}): Playlist {
	return {
		id: "uuid-1",
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

function makeApplyOutcome(): LibraryProcessingApplyOutcome {
	return {
		accountId: "acct-1",
		changeKind: "playlist_management_session_flushed",
		state: {
			accountId: "acct-1",
			enrichment: { requestedAt: null, settledAt: null, activeJobId: null },
			matchSnapshotRefresh: {
				requestedAt: null,
				settledAt: null,
				activeJobId: null,
			},
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		},
		effects: [],
		effectResults: [],
	};
}

function makeSong(overrides: Partial<Song> = {}): Song {
	return {
		id: "song-1",
		spotify_id: "sp-song-1",
		name: "Test Song",
		album_id: null,
		album_name: "Test Album",
		image_url: null,
		artists: ["Artist A"],
		artist_ids: ["art-1"],
		duration_ms: 200000,
		release_year: null,
		release_year_checked_at: null,
		vocal_gender: null,
		language: null,
		language_confidence: null,
		language_secondary: null,
		language_checked_at: null,
		genres: [],
		created_at: "2026-03-28T00:00:00Z",
		updated_at: "2026-03-28T00:00:00Z",
		...overrides,
	};
}

describe("getPlaylistManagementData", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns playlists and target IDs", async () => {
		const p1 = makePlaylist({ id: "uuid-1", is_target: true });
		const p2 = makePlaylist({ id: "uuid-2", is_target: false });
		mockGetPlaylists.mockResolvedValue(Result.ok([p1, p2]));
		mockGetTargetPlaylists.mockResolvedValue(Result.ok([p1]));

		const result = await getPlaylistManagementData();

		expect(result.playlists).toHaveLength(2);
		expect(result.targetPlaylistIds).toEqual(["uuid-1"]);
	});

	it("returns empty for account with no playlists", async () => {
		mockGetPlaylists.mockResolvedValue(Result.ok([]));
		mockGetTargetPlaylists.mockResolvedValue(Result.ok([]));

		const result = await getPlaylistManagementData();

		expect(result.playlists).toHaveLength(0);
		expect(result.targetPlaylistIds).toHaveLength(0);
	});

	it("throws when playlist fetch fails", async () => {
		mockGetPlaylists.mockResolvedValue(
			Result.err(new DatabaseError({ code: "42000", message: "db error" })),
		);
		mockGetTargetPlaylists.mockResolvedValue(Result.ok([]));

		await expect(getPlaylistManagementData()).rejects.toThrow(
			"Failed to load playlists",
		);
	});
});

function makePlaylistSongRow(overrides: { song_id: string; position: number }) {
	return {
		id: `ps-${overrides.position}`,
		playlist_id: "uuid-1",
		song_id: overrides.song_id,
		position: overrides.position,
		added_at: "2026-03-28T00:00:00Z",
		created_at: "2026-03-28T00:00:00Z",
	};
}

describe("getPlaylistTracksPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetPlaylistById.mockResolvedValue(
			Result.ok(makePlaylist({ account_id: "acct-1" })),
		);
	});

	it("returns first page with nextCursor when more rows exist", async () => {
		mockGetPlaylistSongsPage.mockResolvedValue(
			Result.ok({
				items: [
					makePlaylistSongRow({ song_id: "song-1", position: 0 }),
					makePlaylistSongRow({ song_id: "song-2", position: 1 }),
				],
				nextCursor: 2,
			}),
		);
		mockGetSongsByIds.mockResolvedValue(
			Result.ok([
				makeSong({ id: "song-1", name: "Song One" }),
				makeSong({ id: "song-2", name: "Song Two" }),
			]),
		);

		const result = await getPlaylistTracksPage({
			data: { playlistId: "uuid-1", limit: 2 },
		});

		expect(mockGetPlaylistSongsPage).toHaveBeenCalledWith("uuid-1", {
			cursor: undefined,
			limit: 2,
		});
		expect(result.tracks).toHaveLength(2);
		expect(result.tracks[0].name).toBe("Song One");
		expect(result.tracks[1].name).toBe("Song Two");
		expect(result.nextCursor).toBe(2);
	});

	it("forwards cursor to the domain query for subsequent pages", async () => {
		mockGetPlaylistSongsPage.mockResolvedValue(
			Result.ok({
				items: [makePlaylistSongRow({ song_id: "song-3", position: 2 })],
				nextCursor: null,
			}),
		);
		mockGetSongsByIds.mockResolvedValue(
			Result.ok([makeSong({ id: "song-3", name: "Song Three" })]),
		);

		const result = await getPlaylistTracksPage({
			data: { playlistId: "uuid-1", cursor: 2, limit: 2 },
		});

		expect(mockGetPlaylistSongsPage).toHaveBeenCalledWith("uuid-1", {
			cursor: 2,
			limit: 2,
		});
		expect(result.tracks).toHaveLength(1);
		expect(result.tracks[0].position).toBe(2);
		expect(result.nextCursor).toBeNull();
	});

	it("preserves the order returned by the domain query", async () => {
		mockGetPlaylistSongsPage.mockResolvedValue(
			Result.ok({
				items: [
					makePlaylistSongRow({ song_id: "song-1", position: 0 }),
					makePlaylistSongRow({ song_id: "song-2", position: 1 }),
					makePlaylistSongRow({ song_id: "song-3", position: 2 }),
				],
				nextCursor: null,
			}),
		);
		// Return songs in a different order than the playlist order to prove
		// we re-order to match the playlist_song positions, not the song
		// table response order.
		mockGetSongsByIds.mockResolvedValue(
			Result.ok([
				makeSong({ id: "song-3", name: "Song Three" }),
				makeSong({ id: "song-1", name: "Song One" }),
				makeSong({ id: "song-2", name: "Song Two" }),
			]),
		);

		const result = await getPlaylistTracksPage({
			data: { playlistId: "uuid-1", limit: 50 },
		});

		expect(result.tracks.map((t) => t.songId)).toEqual([
			"song-1",
			"song-2",
			"song-3",
		]);
	});

	it("returns empty page when playlist has no tracks", async () => {
		mockGetPlaylistSongsPage.mockResolvedValue(
			Result.ok({ items: [], nextCursor: null }),
		);

		const result = await getPlaylistTracksPage({
			data: { playlistId: "uuid-1", limit: 50 },
		});

		expect(result.tracks).toHaveLength(0);
		expect(result.nextCursor).toBeNull();
	});

	it("returns nextCursor: null on the final page", async () => {
		mockGetPlaylistSongsPage.mockResolvedValue(
			Result.ok({
				items: [makePlaylistSongRow({ song_id: "song-1", position: 0 })],
				nextCursor: null,
			}),
		);
		mockGetSongsByIds.mockResolvedValue(
			Result.ok([makeSong({ id: "song-1" })]),
		);

		const result = await getPlaylistTracksPage({
			data: { playlistId: "uuid-1", limit: 50 },
		});

		expect(result.nextCursor).toBeNull();
	});

	it("filters out songs missing from song table while keeping matched rows", async () => {
		mockGetPlaylistSongsPage.mockResolvedValue(
			Result.ok({
				items: [
					makePlaylistSongRow({ song_id: "song-1", position: 0 }),
					makePlaylistSongRow({ song_id: "song-missing", position: 1 }),
				],
				nextCursor: null,
			}),
		);
		mockGetSongsByIds.mockResolvedValue(
			Result.ok([makeSong({ id: "song-1" })]),
		);

		const result = await getPlaylistTracksPage({
			data: { playlistId: "uuid-1", limit: 50 },
		});

		expect(result.tracks).toHaveLength(1);
		expect(result.tracks[0].songId).toBe("song-1");
	});

	it("skips filtered-empty pages and keeps loading until loadable tracks remain", async () => {
		mockGetPlaylistSongsPage
			.mockResolvedValueOnce(
				Result.ok({
					items: [
						makePlaylistSongRow({ song_id: "song-missing", position: 0 }),
					],
					nextCursor: 1,
				}),
			)
			.mockResolvedValueOnce(
				Result.ok({
					items: [makePlaylistSongRow({ song_id: "song-2", position: 1 })],
					nextCursor: null,
				}),
			);
		mockGetSongsByIds
			.mockResolvedValueOnce(Result.ok([]))
			.mockResolvedValueOnce(Result.ok([makeSong({ id: "song-2" })]));

		const result = await getPlaylistTracksPage({
			data: { playlistId: "uuid-1", limit: 1 },
		});

		expect(mockGetPlaylistSongsPage).toHaveBeenNthCalledWith(1, "uuid-1", {
			cursor: undefined,
			limit: 1,
		});
		expect(mockGetPlaylistSongsPage).toHaveBeenNthCalledWith(2, "uuid-1", {
			cursor: 1,
			limit: 1,
		});
		expect(result.tracks).toHaveLength(1);
		expect(result.tracks[0].songId).toBe("song-2");
		expect(result.nextCursor).toBeNull();
	});

	it("throws sanitized error when playlist lookup fails", async () => {
		mockGetPlaylistById.mockResolvedValue(
			Result.err(new DatabaseError({ code: "42000", message: "db boom" })),
		);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(
			getPlaylistTracksPage({ data: { playlistId: "uuid-1", limit: 50 } }),
		).rejects.toThrow("Failed to load playlist");

		warnSpy.mockRestore();
	});

	it("throws 'Playlist not found' when playlist is missing", async () => {
		mockGetPlaylistById.mockResolvedValue(Result.ok(null));

		await expect(
			getPlaylistTracksPage({ data: { playlistId: "uuid-1", limit: 50 } }),
		).rejects.toThrow("Playlist not found");
	});

	it("throws 'Playlist not found' when playlist belongs to another account", async () => {
		mockGetPlaylistById.mockResolvedValue(
			Result.ok(makePlaylist({ account_id: "acct-other" })),
		);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(
			getPlaylistTracksPage({ data: { playlistId: "uuid-1", limit: 50 } }),
		).rejects.toThrow("Playlist not found");

		expect(warnSpy).toHaveBeenCalledWith(
			"Playlist access denied: account mismatch",
			expect.objectContaining({
				playlistId: "uuid-1",
				ownerAccountId: "acct-other",
				sessionAccountId: "acct-1",
			}),
		);
		warnSpy.mockRestore();
	});

	it("throws sanitized error when playlist-song page query fails", async () => {
		mockGetPlaylistSongsPage.mockResolvedValue(
			Result.err(new DatabaseError({ code: "42000", message: "db boom" })),
		);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(
			getPlaylistTracksPage({ data: { playlistId: "uuid-1", limit: 50 } }),
		).rejects.toThrow("Failed to load playlist tracks");

		warnSpy.mockRestore();
	});

	it("throws sanitized error when song details query fails", async () => {
		mockGetPlaylistSongsPage.mockResolvedValue(
			Result.ok({
				items: [makePlaylistSongRow({ song_id: "song-1", position: 0 })],
				nextCursor: null,
			}),
		);
		mockGetSongsByIds.mockResolvedValue(
			Result.err(new DatabaseError({ code: "42000", message: "db boom" })),
		);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(
			getPlaylistTracksPage({ data: { playlistId: "uuid-1", limit: 50 } }),
		).rejects.toThrow("Failed to load track details");

		warnSpy.mockRestore();
	});
});

describe("setPlaylistTargetMutation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetPlaylistById.mockResolvedValue(
			Result.ok(makePlaylist({ account_id: "acct-1" })),
		);
		// Default: already has a visible card → trigger is skipped
		mockHasFirstVisibleReviewSubject.mockResolvedValue(Result.ok(true));
	});

	it("sets target flag via setPlaylistTarget", async () => {
		const updated = makePlaylist({ is_target: true });
		mockSetPlaylistTarget.mockResolvedValue(Result.ok(updated));

		const result = await setPlaylistTargetMutation({
			data: { playlistId: "uuid-1", isTarget: true },
		});

		expect(result.success).toBe(true);
		expect(mockSetPlaylistTarget).toHaveBeenCalledWith(
			"acct-1",
			"uuid-1",
			true,
		);
	});

	it("throws when setPlaylistTarget fails", async () => {
		mockSetPlaylistTarget.mockResolvedValue(
			Result.err(new DatabaseError({ code: "42000", message: "db error" })),
		);

		await expect(
			setPlaylistTargetMutation({
				data: { playlistId: "uuid-1", isTarget: true },
			}),
		).rejects.toThrow("Failed to set playlist target");
	});

	describe("first-match setup trigger", () => {
		beforeEach(() => {
			mockSetPlaylistTarget.mockResolvedValue(
				Result.ok(makePlaylist({ is_target: true })),
			);
			mockApplyLibraryProcessingChange.mockResolvedValue(
				Result.ok(makeApplyOutcome()),
			);
		});

		it("fires first_match_setup_completed when first target and no visible card", async () => {
			// Exactly one target after the write → isFirstTarget === true
			mockGetTargetPlaylists.mockResolvedValue(
				Result.ok([makePlaylist({ is_target: true })]),
			);
			// No visible card yet → probe returns false → trigger must fire
			mockHasFirstVisibleReviewSubject.mockResolvedValue(Result.ok(false));

			await setPlaylistTargetMutation({
				data: { playlistId: "uuid-1", isTarget: true },
			});

			expect(mockApplyLibraryProcessingChange).toHaveBeenCalledWith(
				expect.objectContaining({ kind: "first_match_setup_completed" }),
			);
		});

		it("does not fire when visible card already exists", async () => {
			mockGetTargetPlaylists.mockResolvedValue(
				Result.ok([makePlaylist({ is_target: true })]),
			);
			// Probe returns true (ready) → trigger must be skipped
			mockHasFirstVisibleReviewSubject.mockResolvedValue(Result.ok(true));

			await setPlaylistTargetMutation({
				data: { playlistId: "uuid-1", isTarget: true },
			});

			expect(mockApplyLibraryProcessingChange).not.toHaveBeenCalled();
		});

		it("does not fire when this is not the first target (≥2 targets)", async () => {
			// Two targets → not the first → skip probe and trigger entirely
			mockGetTargetPlaylists.mockResolvedValue(
				Result.ok([
					makePlaylist({ id: "uuid-1", is_target: true }),
					makePlaylist({ id: "uuid-2", is_target: true }),
				]),
			);
			mockHasFirstVisibleReviewSubject.mockResolvedValue(Result.ok(false));

			await setPlaylistTargetMutation({
				data: { playlistId: "uuid-1", isTarget: true },
			});

			expect(mockApplyLibraryProcessingChange).not.toHaveBeenCalled();
		});

		it("does not fire when isTarget is false", async () => {
			// Removing a target — trigger branch is guarded by data.isTarget
			await setPlaylistTargetMutation({
				data: { playlistId: "uuid-1", isTarget: false },
			});

			expect(mockHasFirstVisibleReviewSubject).not.toHaveBeenCalled();
			expect(mockApplyLibraryProcessingChange).not.toHaveBeenCalled();
		});

		it("does not fire when probe returns a DB error (degrades to ready)", async () => {
			// Fix A: error → firstVisibleReady=true → trigger skipped, not fired
			mockGetTargetPlaylists.mockResolvedValue(
				Result.ok([makePlaylist({ is_target: true })]),
			);
			mockHasFirstVisibleReviewSubject.mockResolvedValue(
				Result.err(
					new DatabaseError({ code: "42000", message: "probe error" }),
				),
			);

			await setPlaylistTargetMutation({
				data: { playlistId: "uuid-1", isTarget: true },
			});

			expect(mockApplyLibraryProcessingChange).not.toHaveBeenCalled();
		});

		it("captures matching_setup_completed event when first target and no visible card", async () => {
			mockGetTargetPlaylists.mockResolvedValue(
				Result.ok([makePlaylist({ is_target: true })]),
			);
			// No visible card → event must fire
			mockHasFirstVisibleReviewSubject.mockResolvedValue(Result.ok(false));

			await setPlaylistTargetMutation({
				data: { playlistId: "uuid-1", isTarget: true },
			});

			expect(mockCaptureWithWaitUntil).toHaveBeenCalledWith(
				expect.objectContaining({
					event: "matching_setup_completed",
					distinctId: "acct-1",
				}),
			);
		});

		it("does not capture matching_setup_completed when visible card already exists", async () => {
			mockGetTargetPlaylists.mockResolvedValue(
				Result.ok([makePlaylist({ is_target: true })]),
			);
			// Already ready → event must NOT fire
			mockHasFirstVisibleReviewSubject.mockResolvedValue(Result.ok(true));

			await setPlaylistTargetMutation({
				data: { playlistId: "uuid-1", isTarget: true },
			});

			expect(mockCaptureWithWaitUntil).not.toHaveBeenCalled();
		});
	});
});

describe("flushPlaylistManagementSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockApplyLibraryProcessingChange.mockResolvedValue(
			Result.ok(makeApplyOutcome()),
		);
		mockSyncActiveQueue.mockResolvedValue(
			Result.ok({ appendedCount: 0, alreadyApplied: false }),
		);
	});

	it("calls applyLibraryProcessingChange when membership changed", async () => {
		const result = await flushPlaylistManagementSession({
			data: {
				targetMembershipChanged: true,
				scoringConfigChanged: false,
				readTimeFilterChanged: false,
			},
		});

		expect(result.flushed).toBe(true);
		expect(mockApplyLibraryProcessingChange).toHaveBeenCalledWith(
			PlaylistManagementChanges.sessionFlushed({
				accountId: "acct-1",
				targetMembershipChanged: true,
				scoringConfigChanged: false,
				readTimeFilterChanged: false,
			}),
		);
		expect(mockSyncActiveQueue).not.toHaveBeenCalled();
	});

	it("calls applyLibraryProcessingChange when scoring config changed", async () => {
		const result = await flushPlaylistManagementSession({
			data: {
				targetMembershipChanged: false,
				scoringConfigChanged: true,
				readTimeFilterChanged: false,
			},
		});

		expect(result.flushed).toBe(true);
		expect(mockApplyLibraryProcessingChange).toHaveBeenCalledWith(
			PlaylistManagementChanges.sessionFlushed({
				accountId: "acct-1",
				targetMembershipChanged: false,
				scoringConfigChanged: true,
				readTimeFilterChanged: false,
			}),
		);
		expect(mockSyncActiveQueue).not.toHaveBeenCalled();
	});

	it("syncs active session for filter-only flush without calling applyLibraryProcessingChange", async () => {
		const result = await flushPlaylistManagementSession({
			data: {
				targetMembershipChanged: false,
				scoringConfigChanged: false,
				readTimeFilterChanged: true,
			},
		});

		expect(result.flushed).toBe(true);
		// Filter-only: sync all active sessions, do NOT enqueue a snapshot refresh.
		// Both orientations are synced so newly visible subjects are appended to
		// whichever session is active (MSR-37).
		expect(mockApplyLibraryProcessingChange).not.toHaveBeenCalled();
		expect(mockSyncActiveQueue).toHaveBeenCalledTimes(2);
		expect(mockSyncActiveQueue).toHaveBeenCalledWith("acct-1", "song");
		expect(mockSyncActiveQueue).toHaveBeenCalledWith("acct-1", "playlist");
	});

	it("still calls applyLibraryProcessingChange for mixed scoring + filter change", async () => {
		const result = await flushPlaylistManagementSession({
			data: {
				targetMembershipChanged: false,
				scoringConfigChanged: true,
				readTimeFilterChanged: true,
			},
		});

		expect(result.flushed).toBe(true);
		// Mixed: scoring change dominates — refresh path, no separate sync needed.
		expect(mockApplyLibraryProcessingChange).toHaveBeenCalledTimes(1);
		expect(mockSyncActiveQueue).not.toHaveBeenCalled();
	});

	it("skips processing when nothing changed", async () => {
		const result = await flushPlaylistManagementSession({
			data: {
				targetMembershipChanged: false,
				scoringConfigChanged: false,
				readTimeFilterChanged: false,
			},
		});

		expect(result.flushed).toBe(false);
		expect(mockApplyLibraryProcessingChange).not.toHaveBeenCalled();
		expect(mockSyncActiveQueue).not.toHaveBeenCalled();
	});
});

describe("savePlaylistGenrePills", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetPlaylistById.mockResolvedValue(
			Result.ok(makePlaylist({ account_id: "acct-1" })),
		);
		mockUpdatePlaylistGenrePills.mockResolvedValue(
			Result.ok(makePlaylist({ genre_pills: ["rock", "pop"] })),
		);
		mockApplyLibraryProcessingChange.mockResolvedValue(
			Result.ok(makeApplyOutcome()),
		);
	});

	it("sanitizes input genres before writing", async () => {
		// "hip hop" canonicalizes to "hip-hop"; "happy" is not in the whitelist
		await savePlaylistGenrePills({
			data: { playlistId: "uuid-1", genres: ["hip hop", "happy", "rock"] },
		});

		expect(mockUpdatePlaylistGenrePills).toHaveBeenCalledWith(
			"acct-1",
			"uuid-1",
			["hip-hop", "rock"],
		);
	});

	it("caps sanitized output at 5 genres", async () => {
		const sixValid = ["rock", "pop", "jazz", "metal", "folk", "electronic"];
		await savePlaylistGenrePills({
			data: { playlistId: "uuid-1", genres: sixValid },
		});

		const [, , pills] = mockUpdatePlaylistGenrePills.mock.calls[0] as [
			string,
			string,
			string[],
		];
		expect(pills).toHaveLength(5);
	});

	it("returns success with the sanitized pills", async () => {
		mockUpdatePlaylistGenrePills.mockResolvedValue(
			Result.ok(makePlaylist({ genre_pills: ["rock"] })),
		);

		const result = await savePlaylistGenrePills({
			data: { playlistId: "uuid-1", genres: ["rock"] },
		});

		expect(result).toEqual({ success: true, pills: ["rock"] });
	});

	it("throws when the playlist is not found", async () => {
		mockGetPlaylistById.mockResolvedValue(Result.ok(null));

		await expect(
			savePlaylistGenrePills({
				data: { playlistId: "uuid-1", genres: ["rock"] },
			}),
		).rejects.toThrow("Playlist not found");
	});

	it("throws when the playlist belongs to another account", async () => {
		mockGetPlaylistById.mockResolvedValue(
			Result.ok(makePlaylist({ account_id: "acct-other" })),
		);

		await expect(
			savePlaylistGenrePills({
				data: { playlistId: "uuid-1", genres: ["rock"] },
			}),
		).rejects.toThrow("Playlist not found");

		expect(mockUpdatePlaylistGenrePills).not.toHaveBeenCalled();
	});

	it("throws when the DB write fails", async () => {
		mockUpdatePlaylistGenrePills.mockResolvedValue(
			Result.err(new DatabaseError({ code: "42000", message: "db error" })),
		);

		await expect(
			savePlaylistGenrePills({
				data: { playlistId: "uuid-1", genres: ["rock"] },
			}),
		).rejects.toThrow("Failed to save genre pills");
	});

	it("fires a scoring-changed session-flushed change to advance matchSnapshotRefresh", async () => {
		await savePlaylistGenrePills({
			data: { playlistId: "uuid-1", genres: ["rock"] },
		});

		expect(mockApplyLibraryProcessingChange).toHaveBeenCalledWith(
			PlaylistManagementChanges.sessionFlushed({
				accountId: "acct-1",
				targetMembershipChanged: false,
				scoringConfigChanged: true,
				readTimeFilterChanged: false,
			}),
		);
	});

	it("succeeds even when snapshot invalidation fails (non-fatal)", async () => {
		mockApplyLibraryProcessingChange.mockResolvedValue(
			Result.err({
				kind: "load_state",
				cause: new DatabaseError({ code: "42000", message: "state error" }),
			}),
		);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await savePlaylistGenrePills({
			data: { playlistId: "uuid-1", genres: ["rock"] },
		});

		expect(result.success).toBe(true);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				"genre pills saved but snapshot invalidation failed",
			),
			expect.anything(),
		);
		errorSpy.mockRestore();
	});
});
