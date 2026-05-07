import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchPlaylistMetadata = vi.fn();
const mockUpdatePlaylistAcknowledged = vi.fn();
const mockAcknowledgePlaylistUpdate = vi.fn();

vi.mock("../spotify-client", () => ({
	fetchPlaylistMetadata: (...args: unknown[]) =>
		mockFetchPlaylistMetadata(...args),
}));

vi.mock("../playlist-write-acknowledgement", () => ({
	updatePlaylistAcknowledged: (...args: unknown[]) =>
		mockUpdatePlaylistAcknowledged(...args),
}));

vi.mock("@/lib/server/playlists.functions", () => ({
	acknowledgePlaylistUpdate: (...args: unknown[]) =>
		mockAcknowledgePlaylistUpdate(...args),
}));

const {
	preparePlaylistDescriptionSave,
	commitPlaylistDescriptionSave,
	syncPreparedPlaylistMetadata,
} = await import("../playlist-description-save");

describe("preparePlaylistDescriptionSave", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns ready when the fetched description matches the baseline", async () => {
		mockFetchPlaylistMetadata.mockResolvedValue({
			ok: true,
			data: {
				name: "My Playlist",
				description: "old description",
				trackCount: 5,
				imageUrl: null,
			},
			commandId: "cmd-1",
		});

		const result = await preparePlaylistDescriptionSave({
			spotifyId: "sp1",
			baselineDescription: "old description",
			nextDescription: "new description",
		});

		expect(result).toEqual({
			status: "ready",
			commit: {
				spotifyId: "sp1",
				nextDescription: "new description",
				latestMetadata: {
					name: "My Playlist",
					description: "old description",
					trackCount: 5,
					imageUrl: null,
				},
			},
		});
	});

	it("returns conflict when the fetched description drifted", async () => {
		mockFetchPlaylistMetadata.mockResolvedValue({
			ok: true,
			data: {
				name: "My Playlist",
				description: "remote description",
				trackCount: 7,
				imageUrl: "https://img.test/cover.jpg",
			},
			commandId: "cmd-1",
		});

		const result = await preparePlaylistDescriptionSave({
			spotifyId: "sp1",
			baselineDescription: "old description",
			nextDescription: "new description",
		});

		expect(result).toEqual({
			status: "conflict",
			latestDescription: "remote description",
			commit: {
				spotifyId: "sp1",
				nextDescription: "new description",
				latestMetadata: {
					name: "My Playlist",
					description: "remote description",
					trackCount: 7,
					imageUrl: "https://img.test/cover.jpg",
				},
			},
		});
	});

	it("maps auth failures to reconnect-required", async () => {
		mockFetchPlaylistMetadata.mockResolvedValue({
			ok: false,
			errorCode: "AUTH_REQUIRED",
			message: "expired",
			retryable: false,
			commandId: "cmd-1",
		});

		await expect(
			preparePlaylistDescriptionSave({
				spotifyId: "sp1",
				baselineDescription: "old description",
				nextDescription: "new description",
			}),
		).resolves.toEqual({ status: "reconnect-required" });
	});
});

describe("commitPlaylistDescriptionSave", () => {
	beforeEach(() => vi.clearAllMocks());

	it("persists the latest fetched metadata alongside the new description", async () => {
		mockUpdatePlaylistAcknowledged.mockResolvedValue({
			ok: true,
			data: { revision: "r1" },
			acknowledged: true,
		});

		await commitPlaylistDescriptionSave({
			spotifyId: "sp1",
			nextDescription: "new description",
			latestMetadata: {
				name: "My Playlist",
				description: "remote description",
				trackCount: 7,
				imageUrl: "https://img.test/cover.jpg",
			},
		});

		expect(mockUpdatePlaylistAcknowledged).toHaveBeenCalledWith("sp1", {
			name: "My Playlist",
			description: "new description",
			songCount: 7,
			imageUrl: "https://img.test/cover.jpg",
		});
	});
});

describe("syncPreparedPlaylistMetadata", () => {
	beforeEach(() => vi.clearAllMocks());

	it("acknowledges the latest spotify metadata without overwriting it", async () => {
		mockAcknowledgePlaylistUpdate.mockResolvedValue({ success: true });

		await expect(
			syncPreparedPlaylistMetadata({
				spotifyId: "sp1",
				nextDescription: "new description",
				latestMetadata: {
					name: "My Playlist",
					description: "remote description",
					trackCount: 7,
					imageUrl: "https://img.test/cover.jpg",
				},
			}),
		).resolves.toEqual({ ok: true });

		expect(mockAcknowledgePlaylistUpdate).toHaveBeenCalledWith({
			data: {
				spotifyId: "sp1",
				name: "My Playlist",
				description: "remote description",
				songCount: 7,
				imageUrl: "https://img.test/cover.jpg",
			},
		});
	});

	it("returns an explicit failure when the db sync fails", async () => {
		const error = new Error("db sync failed");
		mockAcknowledgePlaylistUpdate.mockRejectedValue(error);

		await expect(
			syncPreparedPlaylistMetadata({
				spotifyId: "sp1",
				nextDescription: "new description",
				latestMetadata: {
					name: "My Playlist",
					description: "remote description",
					trackCount: 7,
					imageUrl: null,
				},
			}),
		).resolves.toEqual({ ok: false, error });
	});
});
