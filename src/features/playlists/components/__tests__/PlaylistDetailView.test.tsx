import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import type { ThemeConfig } from "@/lib/theme/types";
import { render } from "@/test/utils/render";
import { PlaylistDetailView } from "../PlaylistDetailView";

const mockSaveGenrePills = vi.fn();
const mockSaveMatchIntent = vi.fn();

vi.mock("@/lib/server/playlists.functions", () => ({
	savePlaylistGenrePills: (...args: unknown[]) => mockSaveGenrePills(...args),
	savePlaylistMatchIntent: (...args: unknown[]) => mockSaveMatchIntent(...args),
	getAccountTopGenres: vi.fn().mockResolvedValue({ genres: [] }),
	getPlaylistManagementData: vi.fn(),
	getPlaylistTracksPage: vi.fn(),
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
	description: "spotify description",
	match_intent: "old intent",
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

function renderView(overrides?: { onMetadataChanged?: () => void }) {
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
		mockSaveGenrePills.mockResolvedValue({ success: true, pills: [] });
		mockSaveMatchIntent.mockResolvedValue({ success: true, matchIntent: null });
	});

	afterEach(() => {
		cleanup();
	});

	it("surfaces the match_intent text, never the Spotify description", () => {
		renderView();
		expect(screen.getByText("old intent")).toBeTruthy();
		expect(screen.queryByText("spotify description")).toBeNull();
	});

	it("closes edit mode without saving when nothing changed", async () => {
		const { user } = renderView();

		await user.click(screen.getByRole("button", { name: /old intent/i }));
		await user.click(screen.getByRole("button", { name: /^save$/i }));

		expect(mockSaveMatchIntent).not.toHaveBeenCalled();
		expect(screen.queryByRole("textbox")).toBeNull();
	});

	it("saves match_intent to our DB on edit — no extension or reconnect prompt", async () => {
		const onMetadataChanged = vi.fn();
		const { user } = renderView({ onMetadataChanged });

		await user.click(screen.getByRole("button", { name: /old intent/i }));
		await user.clear(screen.getByRole("textbox"));
		await user.type(screen.getByRole("textbox"), "new intent");
		await user.click(screen.getByRole("button", { name: /^save$/i }));

		await vi.waitFor(() => {
			expect(mockSaveMatchIntent).toHaveBeenCalledWith({
				data: { playlistId: "p1", matchIntent: "new intent" },
			});
		});
		await vi.waitFor(() => {
			expect(onMetadataChanged).toHaveBeenCalledTimes(1);
		});
		expect(screen.queryByText(/extension/i)).toBeNull();
		expect(screen.queryByText(/reconnect/i)).toBeNull();
		expect(screen.queryByRole("textbox")).toBeNull();
	});

	it("saves empty text as null", async () => {
		const { user } = renderView();

		await user.click(screen.getByRole("button", { name: /old intent/i }));
		await user.clear(screen.getByRole("textbox"));
		await user.click(screen.getByRole("button", { name: /^save$/i }));

		await vi.waitFor(() => {
			expect(mockSaveMatchIntent).toHaveBeenCalledWith({
				data: { playlistId: "p1", matchIntent: null },
			});
		});
	});

	it("holds the surface open with a failure line when the save fails", async () => {
		mockSaveMatchIntent.mockRejectedValue(new Error("save failed"));
		const { user } = renderView();

		await user.click(screen.getByRole("button", { name: /old intent/i }));
		await user.clear(screen.getByRole("textbox"));
		await user.type(screen.getByRole("textbox"), "new intent");
		await user.click(screen.getByRole("button", { name: /^save$/i }));

		expect(
			await screen.findByText(/something went sideways saving that/i),
		).toBeTruthy();
		// Still editing — the textarea remains so the user can retry.
		expect(screen.getByRole("textbox")).toBeTruthy();
	});
});
