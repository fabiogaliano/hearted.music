import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@/test/utils/render";
import { PlaylistsScreen } from "../PlaylistsScreen";
import type { ThemeConfig } from "@/lib/theme/types";

const mockPlaylistData = vi.fn();
const mockIsExtensionInstalled = vi.fn();

vi.mock("@/lib/server/playlists.functions", () => ({
	getPlaylistManagementData: () => mockPlaylistData(),
	getPlaylistTrackPreview: vi.fn().mockResolvedValue([]),
	setPlaylistTargetMutation: vi.fn(),
	flushPlaylistManagementSession: vi.fn(),
}));

vi.mock("@/lib/extension/detect", () => ({
	isExtensionInstalled: () => mockIsExtensionInstalled(),
}));

vi.mock("@/lib/extension/playlist-write-acknowledgement", () => ({
	updatePlaylistAcknowledged: vi.fn(),
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

function renderWithClient(ui: React.ReactElement) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: 0 },
		},
	});
	return render(
		<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
	) as ReturnType<typeof render>;
}

describe("PlaylistsScreen", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsExtensionInstalled.mockResolvedValue(false);
	});

	it("shows empty state when no playlists synced", async () => {
		mockPlaylistData.mockResolvedValue({
			playlists: [],
			targetPlaylistIds: [],
		});

		renderWithClient(<PlaylistsScreen theme={theme} accountId="acct-1" />);

		expect(await screen.findByText("No playlists synced yet")).toBeTruthy();
	});

	it("renders split view with target rail and library", async () => {
		mockPlaylistData.mockResolvedValue({
			playlists: [
				{
					id: "p1",
					account_id: "acct-1",
					spotify_id: "sp1",
					name: "Target Playlist",
					description: null,
					snapshot_id: null,
					is_public: true,
					song_count: 5,
					is_target: true,
					image_url: null,
					created_at: "2026-03-28T00:00:00Z",
					updated_at: "2026-03-28T00:00:00Z",
				},
				{
					id: "p2",
					account_id: "acct-1",
					spotify_id: "sp2",
					name: "Library Playlist",
					description: "A nice playlist",
					snapshot_id: null,
					is_public: true,
					song_count: 10,
					is_target: false,
					image_url: null,
					created_at: "2026-03-28T00:00:00Z",
					updated_at: "2026-03-28T00:00:00Z",
				},
			],
			targetPlaylistIds: ["p1"],
		});

		renderWithClient(<PlaylistsScreen theme={theme} accountId="acct-1" />);

		expect(await screen.findByText("Matching Playlists")).toBeTruthy();
		expect(screen.getByText("Target Playlist")).toBeTruthy();
		expect(screen.getByText("Library Playlist")).toBeTruthy();
		expect(screen.getByText("Available Library · 1")).toBeTruthy();
	});

	it("shows target-rail empty state when no targets", async () => {
		mockPlaylistData.mockResolvedValue({
			playlists: [
				{
					id: "p1",
					account_id: "acct-1",
					spotify_id: "sp1",
					name: "Some Playlist",
					description: null,
					snapshot_id: null,
					is_public: true,
					song_count: 3,
					is_target: false,
					image_url: null,
					created_at: "2026-03-28T00:00:00Z",
					updated_at: "2026-03-28T00:00:00Z",
				},
			],
			targetPlaylistIds: [],
		});

		renderWithClient(<PlaylistsScreen theme={theme} accountId="acct-1" />);

		expect(await screen.findByText("No active playlists yet.")).toBeTruthy();
	});
});
