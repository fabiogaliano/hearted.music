import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThemeConfig } from "@/lib/theme/types";
import { render } from "@/test/utils/render";
import { PlaylistsScreen } from "../PlaylistsScreen";

const mockPlaylistData = vi.fn();
const mockIsExtensionInstalled = vi.fn();
const mockRouterState = vi.hoisted(() => ({
	params: {} as { playlistRef?: string },
}));

vi.mock("@tanstack/react-router", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
		"@tanstack/react-router",
	);
	return {
		...actual,
		useNavigate: () => vi.fn(),
		useParams: () => mockRouterState.params,
	};
});

vi.mock("@/lib/server/playlists.functions", () => ({
	getPlaylistManagementData: () => mockPlaylistData(),
	getPlaylistTracksPage: vi
		.fn()
		.mockResolvedValue({ tracks: [], nextCursor: null }),
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
		mockRouterState.params = {};
		mockIsExtensionInstalled.mockResolvedValue(false);
	});

	it("shows empty state when no playlists synced", async () => {
		mockPlaylistData.mockResolvedValue({
			playlists: [],
			targetPlaylistIds: [],
		});

		renderWithClient(<PlaylistsScreen theme={theme} accountId="acct-1" />);

		expect(await screen.findByText("No playlists yet.")).toBeTruthy();
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
		expect(screen.getByText("Available")).toBeTruthy();
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

		expect(await screen.findByText("No matching playlists yet.")).toBeTruthy();
	});

	function playlist(
		id: string,
		name: string,
		isTarget: boolean,
	): Record<string, unknown> {
		return {
			id,
			account_id: "acct-1",
			spotify_id: `sp-${id}`,
			name,
			description: null,
			snapshot_id: null,
			is_public: true,
			song_count: 5,
			is_target: isTarget,
			image_url: null,
			created_at: "2026-03-28T00:00:00Z",
			updated_at: "2026-03-28T00:00:00Z",
		};
	}

	function getRowByName(name: string): HTMLElement {
		const node = screen.getByText(name).closest('[role="button"]');
		if (!(node instanceof HTMLElement)) {
			throw new Error(`row for "${name}" not found`);
		}
		return node;
	}

	// `.focus()` is a DOM call — React processes the focus event but its state
	// updates batch into a microtask. Wrap in act() so any pending state and
	// effects flush before the next assertion or fireEvent.
	async function focusRow(name: string): Promise<HTMLElement> {
		const row = getRowByName(name);
		await act(async () => {
			row.focus();
		});
		return row;
	}

	describe("two-column keyboard navigation", () => {
		it("Down from the last Matching row focuses the first Available row", () => {
			mockPlaylistData.mockResolvedValue({
				playlists: [
					playlist("m1", "Match 1", true),
					playlist("m2", "Match 2", true),
					playlist("a1", "Avail 1", false),
					playlist("a2", "Avail 2", false),
				],
				targetPlaylistIds: ["m1", "m2"],
			});

			return (async () => {
				renderWithClient(<PlaylistsScreen theme={theme} accountId="acct-1" />);
				await screen.findByText("Match 1");

				await focusRow("Match 2");
				fireEvent.keyDown(window, { key: "j" });
				expect(document.activeElement).toBe(getRowByName("Avail 1"));
			})();
		});

		it("Up from the first Available row focuses the last Matching row", async () => {
			mockPlaylistData.mockResolvedValue({
				playlists: [
					playlist("m1", "Match 1", true),
					playlist("m2", "Match 2", true),
					playlist("a1", "Avail 1", false),
				],
				targetPlaylistIds: ["m1", "m2"],
			});

			renderWithClient(<PlaylistsScreen theme={theme} accountId="acct-1" />);
			await screen.findByText("Match 1");

			await focusRow("Avail 1");
			fireEvent.keyDown(window, { key: "k" });
			expect(document.activeElement).toBe(getRowByName("Match 2"));
		});

		it("Right from any Matching row focuses the first Available row", async () => {
			mockPlaylistData.mockResolvedValue({
				playlists: [
					playlist("m1", "Match 1", true),
					playlist("m2", "Match 2", true),
					playlist("a1", "Avail 1", false),
				],
				targetPlaylistIds: ["m1", "m2"],
			});

			renderWithClient(<PlaylistsScreen theme={theme} accountId="acct-1" />);
			await screen.findByText("Match 1");

			await focusRow("Match 1");
			fireEvent.keyDown(window, { key: "l" });
			expect(document.activeElement).toBe(getRowByName("Avail 1"));
		});

		it("Left from any Available row focuses the first Matching row", async () => {
			mockPlaylistData.mockResolvedValue({
				playlists: [
					playlist("m1", "Match 1", true),
					playlist("m2", "Match 2", true),
					playlist("a1", "Avail 1", false),
					playlist("a2", "Avail 2", false),
				],
				targetPlaylistIds: ["m1", "m2"],
			});

			renderWithClient(<PlaylistsScreen theme={theme} accountId="acct-1" />);
			await screen.findByText("Match 1");

			await focusRow("Avail 2");
			fireEvent.keyDown(window, { key: "h" });
			expect(document.activeElement).toBe(getRowByName("Match 1"));
		});

		it("Down from the last Available row does not wrap", async () => {
			mockPlaylistData.mockResolvedValue({
				playlists: [
					playlist("m1", "Match 1", true),
					playlist("a1", "Avail 1", false),
				],
				targetPlaylistIds: ["m1"],
			});

			renderWithClient(<PlaylistsScreen theme={theme} accountId="acct-1" />);
			await screen.findByText("Match 1");

			const availLast = await focusRow("Avail 1");
			fireEvent.keyDown(window, { key: "j" });
			expect(document.activeElement).toBe(availLast);
		});

		it("Up from the first Matching row does not wrap", async () => {
			mockPlaylistData.mockResolvedValue({
				playlists: [
					playlist("m1", "Match 1", true),
					playlist("a1", "Avail 1", false),
				],
				targetPlaylistIds: ["m1"],
			});

			renderWithClient(<PlaylistsScreen theme={theme} accountId="acct-1" />);
			await screen.findByText("Match 1");

			const matchFirst = await focusRow("Match 1");
			fireEvent.keyDown(window, { key: "k" });
			expect(document.activeElement).toBe(matchFirst);
		});

		it("Left from Available is a no-op when Matching is empty", async () => {
			mockPlaylistData.mockResolvedValue({
				playlists: [
					playlist("a1", "Avail 1", false),
					playlist("a2", "Avail 2", false),
				],
				targetPlaylistIds: [],
			});

			renderWithClient(<PlaylistsScreen theme={theme} accountId="acct-1" />);
			await screen.findByText("Avail 1");

			const availFirst = await focusRow("Avail 1");
			fireEvent.keyDown(window, { key: "h" });
			expect(document.activeElement).toBe(availFirst);
		});

		it("Right from Matching is a no-op when Available is empty", async () => {
			mockPlaylistData.mockResolvedValue({
				playlists: [
					playlist("m1", "Match 1", true),
					playlist("m2", "Match 2", true),
				],
				targetPlaylistIds: ["m1", "m2"],
			});

			renderWithClient(<PlaylistsScreen theme={theme} accountId="acct-1" />);
			await screen.findByText("Match 1");

			const matchFirst = await focusRow("Match 1");
			fireEvent.keyDown(window, { key: "l" });
			expect(document.activeElement).toBe(matchFirst);
		});

		it("does not run list shortcuts while the search input has focus", async () => {
			mockPlaylistData.mockResolvedValue({
				playlists: [
					playlist("m1", "Match 1", true),
					playlist("m2", "Match 2", true),
					playlist("a1", "Avail 1", false),
				],
				targetPlaylistIds: ["m1", "m2"],
			});

			renderWithClient(<PlaylistsScreen theme={theme} accountId="acct-1" />);
			await screen.findByText("Match 1");

			const searchInput =
				screen.queryByRole("searchbox") ?? screen.queryByRole("textbox");
			if (!searchInput) {
				throw new Error("expected a focusable search input to be rendered");
			}
			searchInput.focus();
			fireEvent.keyDown(searchInput, { key: "j" });
			expect(document.activeElement).toBe(searchInput);
		});

		it("does not hijack lateral shortcuts when focus is on a nested action button", async () => {
			mockPlaylistData.mockResolvedValue({
				playlists: [
					playlist("m1", "Match 1", true),
					playlist("a1", "Avail 1", false),
				],
				targetPlaylistIds: ["m1"],
			});

			renderWithClient(<PlaylistsScreen theme={theme} accountId="acct-1" />);
			await screen.findByText("Match 1");

			const matchRow = await focusRow("Match 1");
			const removeBtn = within(matchRow).getByRole("button", {
				name: /Remove Match 1 from matching/i,
			});
			await act(async () => {
				removeBtn.focus();
			});
			fireEvent.keyDown(window, { key: "l" });
			expect(document.activeElement).toBe(removeBtn);
		});
	});

	it("does not scroll the page when opening a direct playlist link", async () => {
		const scrollIntoView = vi.fn();
		const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
		HTMLElement.prototype.scrollIntoView = scrollIntoView;

		try {
			mockRouterState.params = { playlistRef: "yilkes--a5223c95a3f5" };
			mockPlaylistData.mockResolvedValue({
				playlists: [
					{
						id: "a5223c95a3f5",
						account_id: "acct-1",
						spotify_id: "sp1",
						name: "yilkes!",
						description: "2!!",
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

			const { user } = renderWithClient(
				<PlaylistsScreen theme={theme} accountId="acct-1" />,
			);

			expect(
				await screen.findByRole("heading", { name: "yilkes!" }),
			).toBeTruthy();
			expect(scrollIntoView).not.toHaveBeenCalled();

			await user.click(
				screen.getByRole("button", { name: "Close detail view" }),
			);
			// Flush pending effects deterministically rather than sleeping on a timer.
			await act(async () => {});
			expect(scrollIntoView).not.toHaveBeenCalled();
		} finally {
			HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
		}
	});
});
