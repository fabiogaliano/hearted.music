import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import type { PreparedPlaylistDescriptionSave } from "@/lib/extension/playlist-description-save";
import type { ThemeConfig } from "@/lib/theme/types";
import { render } from "@/test/utils/render";
import { PlaylistDetailView } from "../PlaylistDetailView";

const mockPrepareSave = vi.fn();
const mockCommitSave = vi.fn();
const mockOutcomeFromCommit = vi.fn();
const mockSyncPreparedPlaylistMetadata = vi.fn();
const mockIsExtensionInstalled = vi.fn();

vi.mock("@/lib/extension/playlist-description-save", () => ({
	preparePlaylistDescriptionSave: (...args: unknown[]) =>
		mockPrepareSave(...args),
	commitPlaylistDescriptionSave: (...args: unknown[]) =>
		mockCommitSave(...args),
	syncPreparedPlaylistMetadata: (...args: unknown[]) =>
		mockSyncPreparedPlaylistMetadata(...args),
	outcomeFromCommittedPlaylistDescriptionSave: (...args: unknown[]) =>
		mockOutcomeFromCommit(...args),
}));

vi.mock("@/lib/extension/detect", () => ({
	isExtensionInstalled: () => mockIsExtensionInstalled(),
	expectLoginReturn: vi.fn().mockResolvedValue(true),
}));

vi.mock("../PlaylistTrackList", () => ({
	PlaylistTrackList: () => null,
}));

const theme: ThemeConfig = {
	name: "test",
	bg: "#fff",
	surface: "#f5f5f5",
	surfaceDim: "#eee",
	border: "#ddd",
	text: "#111",
	textMuted: "#666",
	textOnPrimary: "#fff",
	primary: "#333",
	primaryHover: "#222",
};

const playlist: Playlist = {
	id: "p1",
	account_id: "acct-1",
	spotify_id: "sp1",
	name: "My Playlist",
	description: "old description",
	snapshot_id: null,
	is_public: true,
	song_count: 5,
	is_target: false,
	image_url: null,
	genre_pills: [],
	created_at: "2026-04-01T00:00:00Z",
	updated_at: "2026-04-01T00:00:00Z",
};

const rect = { top: 0, left: 0, width: 800, height: 600 };

function buildCommit(overrides: Partial<PreparedPlaylistDescriptionSave> = {}) {
	return {
		spotifyId: "sp1",
		nextDescription: "new description",
		latestMetadata: {
			name: "My Playlist",
			description: "old description",
			trackCount: 5,
			imageUrl: null,
		},
		...overrides,
	};
}

function renderView(overrides?: {
	extensionStatus?: "available" | "checking" | "unavailable";
	onMetadataChanged?: () => void;
}) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<PlaylistDetailView
				theme={theme}
				playlist={playlist}
				isTarget={false}
				isExpanded={true}
				startRect={rect}
				expandedRect={rect}
				extensionStatus={overrides?.extensionStatus ?? "available"}
				accountId="acct-1"
				onClose={() => {}}
				onToggleTarget={() => {}}
				onMetadataChanged={overrides?.onMetadataChanged ?? (() => {})}
			/>
		</QueryClientProvider>,
	);
}

describe("PlaylistDetailView", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockOutcomeFromCommit.mockReturnValue({ status: "success" });
		mockSyncPreparedPlaylistMetadata.mockResolvedValue({ ok: true });
	});

	afterEach(() => {
		cleanup();
	});

	it("does not fetch metadata when the detail opens", async () => {
		renderView();
		// Flush on-mount async (extension check) deterministically instead of
		// waiting on a wall-clock timer before asserting the negative.
		await act(async () => {});
		expect(mockPrepareSave).not.toHaveBeenCalled();
		expect(mockCommitSave).not.toHaveBeenCalled();
	});

	it("closes edit mode without calling Spotify when nothing changed", async () => {
		const { user } = renderView();

		await user.click(screen.getByRole("button", { name: /old description/i }));
		await user.click(screen.getByRole("button", { name: /^save$/i }));

		expect(mockPrepareSave).not.toHaveBeenCalled();
		expect(screen.queryByRole("textbox")).toBeNull();
	});

	it("prepares then commits when save has no conflict", async () => {
		const onMetadataChanged = vi.fn();
		const commit = buildCommit();
		mockPrepareSave.mockResolvedValue({ status: "ready", commit });
		mockCommitSave.mockResolvedValue({
			ok: true,
			data: { revision: "r1" },
			acknowledged: true,
		});

		const { user } = renderView({ onMetadataChanged });

		await user.click(screen.getByRole("button", { name: /old description/i }));
		await user.clear(screen.getByRole("textbox"));
		await user.type(screen.getByRole("textbox"), "new description");
		await user.click(screen.getByRole("button", { name: /^save$/i }));

		expect(mockPrepareSave).toHaveBeenCalledWith({
			spotifyId: "sp1",
			baselineDescription: "old description",
			nextDescription: "new description",
		});
		expect(mockCommitSave).toHaveBeenCalledWith(commit);
		await vi.waitFor(() => {
			expect(onMetadataChanged).toHaveBeenCalledTimes(1);
		});
	});

	it("shows overwrite confirmation when remote description changed", async () => {
		const onMetadataChanged = vi.fn();
		const commit = buildCommit({
			latestMetadata: {
				name: "My Playlist",
				description: "remote description",
				trackCount: 5,
				imageUrl: null,
			},
		});
		mockPrepareSave.mockResolvedValue({
			status: "conflict",
			latestDescription: "remote description",
			commit,
		});
		mockCommitSave.mockResolvedValue({
			ok: true,
			data: { revision: "r2" },
			acknowledged: true,
		});

		const { user } = renderView({ onMetadataChanged });

		await user.click(screen.getByRole("button", { name: /old description/i }));
		await user.clear(screen.getByRole("textbox"));
		await user.type(screen.getByRole("textbox"), "new description");
		await user.click(screen.getByRole("button", { name: /^save$/i }));

		expect(mockSyncPreparedPlaylistMetadata).toHaveBeenCalledWith(commit);
		await vi.waitFor(() => {
			expect(onMetadataChanged).toHaveBeenCalledTimes(1);
		});

		expect(await screen.findByText(/this description/i)).toBeTruthy();
		expect(screen.getByText(/on spotify now/i)).toBeTruthy();
		expect(screen.getByText(/yours/i)).toBeTruthy();
		expect(mockCommitSave).not.toHaveBeenCalled();

		await user.click(screen.getByRole("button", { name: /keep mine/i }));
		expect(mockCommitSave).toHaveBeenCalledWith(commit);
	});

	it("shows a failure state when conflict sync cannot update the db", async () => {
		const commit = buildCommit({
			latestMetadata: {
				name: "My Playlist",
				description: "remote description",
				trackCount: 5,
				imageUrl: null,
			},
		});
		mockPrepareSave.mockResolvedValue({
			status: "conflict",
			latestDescription: "remote description",
			commit,
		});
		mockSyncPreparedPlaylistMetadata.mockResolvedValue({
			ok: false,
			error: new Error("db sync failed"),
		});

		const { user } = renderView();

		await user.click(screen.getByRole("button", { name: /old description/i }));
		await user.clear(screen.getByRole("textbox"));
		await user.type(screen.getByRole("textbox"), "new description");
		await user.click(screen.getByRole("button", { name: /^save$/i }));

		expect(
			await screen.findByText(/something went sideways saving that/i),
		).toBeTruthy();
		expect(screen.queryByText(/this description/i)).toBeNull();
	});

	it("renders reconnect CTA when preparation requires auth", async () => {
		mockPrepareSave.mockResolvedValue({ status: "reconnect-required" });

		const { user } = renderView();
		await user.click(screen.getByRole("button", { name: /old description/i }));
		await user.clear(screen.getByRole("textbox"));
		await user.type(screen.getByRole("textbox"), "new description");
		await user.click(screen.getByRole("button", { name: /^save$/i }));

		expect(
			await screen.findByText(/reconnect to spotify, then repeat this edit/i),
		).toBeTruthy();
		expect(screen.getByRole("link", { name: /reconnect/i })).toBeTruthy();
	});

	it("renders install CTA when commit fails because extension is gone", async () => {
		const commit = buildCommit();
		mockPrepareSave.mockResolvedValue({ status: "ready", commit });
		mockCommitSave.mockResolvedValue({ ok: false, commandResponse: {} });
		mockOutcomeFromCommit.mockReturnValue({ status: "extension-unavailable" });
		mockIsExtensionInstalled.mockResolvedValue(false);

		const { user } = renderView();
		await user.click(screen.getByRole("button", { name: /old description/i }));
		await user.clear(screen.getByRole("textbox"));
		await user.type(screen.getByRole("textbox"), "new description");
		await user.click(screen.getByRole("button", { name: /^save$/i }));

		expect(
			await screen.findByText(/the extension is required to edit playlists/i),
		).toBeTruthy();
		expect(
			screen.getByRole("link", { name: /install extension/i }),
		).toBeTruthy();
	});
});
