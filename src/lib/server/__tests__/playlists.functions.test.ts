import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import { DatabaseError } from "@/lib/shared/errors/database";
import {
	acknowledgePlaylistCreate,
	savePlaylistMatchConfig,
} from "../playlists.functions";

const {
	mockAuthContext,
	mockUpsertPlaylists,
	mockGetPlaylistById,
	mockUpdatePlaylistMatchConfig,
	mockApplyLibraryProcessingChange,
	mockEnqueueDeckJob,
	mockGetLatestMatchSnapshot,
	mockResolveVisibilityConfigHash,
} = vi.hoisted(() => ({
	mockAuthContext: {
		session: { accountId: "acct-1" },
		account: null,
	},
	mockUpsertPlaylists: vi.fn(),
	mockGetPlaylistById: vi.fn(),
	mockUpdatePlaylistMatchConfig: vi.fn(),
	mockApplyLibraryProcessingChange: vi.fn(),
	mockEnqueueDeckJob: vi.fn(),
	mockGetLatestMatchSnapshot: vi.fn(),
	mockResolveVisibilityConfigHash: vi.fn(),
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
	upsertPlaylists: (...args: unknown[]) => mockUpsertPlaylists(...args),
	getPlaylists: vi.fn().mockResolvedValue({ ok: true, value: [] }),
	getTargetPlaylists: vi.fn().mockResolvedValue({ ok: true, value: [] }),
	getPlaylistById: (...args: unknown[]) => mockGetPlaylistById(...args),
	getPlaylistSongs: vi.fn().mockResolvedValue({ ok: true, value: [] }),
	setPlaylistTarget: vi.fn(),
	updatePlaylistMatchConfig: (...args: unknown[]) =>
		mockUpdatePlaylistMatchConfig(...args),
}));

vi.mock("@/lib/domains/library/songs/queries", () => ({
	getByIds: vi.fn().mockResolvedValue({ ok: true, value: [] }),
}));

vi.mock("@/lib/workflows/library-processing/service", () => ({
	applyLibraryProcessingChange: (...args: unknown[]) =>
		mockApplyLibraryProcessingChange(...args),
}));

vi.mock("@/lib/domains/taste/match-review-queue/deck-jobs", () => ({
	enqueueDeckJob: (...args: unknown[]) => mockEnqueueDeckJob(...args),
}));

vi.mock("@/lib/domains/taste/song-matching/queries", () => ({
	getLatestMatchSnapshot: (...args: unknown[]) =>
		mockGetLatestMatchSnapshot(...args),
}));

vi.mock(
	"@/lib/domains/taste/match-review-queue/visibility-config-hash",
	() => ({
		resolveVisibilityConfigHash: (...args: unknown[]) =>
			mockResolveVisibilityConfigHash(...args),
	}),
);

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

describe("acknowledgePlaylistCreate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("upserts a provisional playlist row from the create URI and name", async () => {
		mockUpsertPlaylists.mockResolvedValue(Result.ok([makePlaylist()]));

		const result = await acknowledgePlaylistCreate({
			data: { uri: "spotify:playlist:abc123", name: "My New Playlist" },
		});

		expect(result).toEqual({ success: true, spotifyId: "abc123" });
		expect(mockUpsertPlaylists).toHaveBeenCalledWith("acct-1", [
			{
				spotify_id: "abc123",
				name: "My New Playlist",
				description: null,
				snapshot_id: null,
				is_public: true,
				song_count: 0,
				is_target: false,
				image_url: null,
			},
		]);
	});

	it("throws when upsert fails", async () => {
		mockUpsertPlaylists.mockResolvedValue(
			Result.err(new DatabaseError({ code: "42000", message: "db error" })),
		);

		await expect(
			acknowledgePlaylistCreate({
				data: { uri: "spotify:playlist:abc123", name: "Test" },
			}),
		).rejects.toThrow("Failed to acknowledge playlist create");
	});
});

describe("savePlaylistMatchConfig", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAuthContext.session = { accountId: "acct-1" };
		mockGetPlaylistById.mockResolvedValue(Result.ok(makePlaylist()));
		mockUpdatePlaylistMatchConfig.mockResolvedValue(Result.ok(makePlaylist()));
		mockApplyLibraryProcessingChange.mockResolvedValue(Result.ok(null));
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockEnqueueDeckJob.mockResolvedValue(Result.ok(null));
		mockResolveVisibilityConfigHash.mockResolvedValue(
			Result.ok({ hash: "vc_test_hash", minScore: 0.5, policy: {} }),
		);
	});

	it("normalizes duplicate language codes before persisting and returning", async () => {
		const result = await savePlaylistMatchConfig({
			data: {
				playlistId: "uuid-1",
				matchIntent: null,
				genrePills: [],
				matchFilters: {
					version: 1,
					languages: { codes: ["en", "en", "pt", "en"] },
				},
			},
		});

		const deduped = { version: 1, languages: { codes: ["en", "pt"] } };
		expect(result.matchFilters).toEqual(deduped);
		expect(mockUpdatePlaylistMatchConfig).toHaveBeenCalledWith(
			"acct-1",
			"uuid-1",
			expect.objectContaining({ matchFilters: deduped }),
		);
	});

	it("rejects ownership mismatch before writing", async () => {
		mockGetPlaylistById.mockResolvedValue(
			Result.ok(makePlaylist({ account_id: "acct-other" })),
		);

		await expect(
			savePlaylistMatchConfig({
				data: {
					playlistId: "uuid-1",
					matchIntent: null,
					genrePills: [],
					matchFilters: { version: 1 },
				},
			}),
		).rejects.toThrow("Playlist not found");
		expect(mockUpdatePlaylistMatchConfig).not.toHaveBeenCalled();
	});

	it("throws on invalid match filters without writing", async () => {
		await expect(
			savePlaylistMatchConfig({
				data: {
					playlistId: "uuid-1",
					matchIntent: null,
					genrePills: [],
					matchFilters: { version: 1, languages: { codes: ["xx-invented"] } },
				},
			}),
		).rejects.toThrow("Invalid match filters");
		expect(mockUpdatePlaylistMatchConfig).not.toHaveBeenCalled();
	});
});
