import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import type { ThemeConfig } from "@/lib/theme/types";
import { render } from "@/test/utils/render";
import type { CommandResponse } from "../../../../../shared/spotify-command-protocol";
import { PlaylistDetailView } from "../PlaylistDetailView";

const mockUpdate = vi.fn();
const mockIsExtensionInstalled = vi.fn();

vi.mock("@/lib/extension/playlist-write-acknowledgement", () => ({
	updatePlaylistAcknowledged: (...args: unknown[]) => mockUpdate(...args),
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
	created_at: "2026-04-01T00:00:00Z",
	updated_at: "2026-04-01T00:00:00Z",
};

const rect = { top: 0, left: 0, width: 800, height: 600 };

function renderView() {
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
				extensionStatus="available"
				accountId="acct-1"
				onClose={() => {}}
				onToggleTarget={() => {}}
				onMetadataChanged={() => {}}
			/>
		</QueryClientProvider>,
	);
}

async function triggerFailedSave(user: ReturnType<typeof renderView>["user"]) {
	await user.click(screen.getByRole("button", { name: /old description/i }));
	await user.click(screen.getByRole("button", { name: /^save$/i }));
}

describe("PlaylistDetailView — edit failure states", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsExtensionInstalled.mockResolvedValue(true);
	});

	afterEach(() => {
		cleanup();
	});

	it("renders reconnect CTA when command returns AUTH_REQUIRED", async () => {
		const cmd: CommandResponse<{ revision: string }> = {
			ok: false,
			errorCode: "AUTH_REQUIRED",
			message: "expired",
			retryable: false,
			commandId: "c1",
		};
		mockUpdate.mockResolvedValue({ ok: false, commandResponse: cmd });

		const { user } = renderView();
		await triggerFailedSave(user);

		expect(
			await screen.findByText(/reconnect to spotify, then repeat this edit/i),
		).toBeTruthy();
		const reconnectLink = screen.getByRole("link", { name: /reconnect/i });
		const href = reconnectLink.getAttribute("href") ?? "";
		const url = new URL(href);
		expect(url.origin + url.pathname).toBe("https://open.spotify.com/");
		expect(url.hash).toBe("");
		expect(reconnectLink.getAttribute("target")).toBe("_blank");
		expect(reconnectLink.getAttribute("rel")).toBe("noopener noreferrer");
	});

	it("renders install CTA when command returns NETWORK_ERROR and extension is not installed", async () => {
		const cmd: CommandResponse<{ revision: string }> = {
			ok: false,
			errorCode: "NETWORK_ERROR",
			message: "offline",
			retryable: true,
			commandId: "c1",
		};
		mockUpdate.mockResolvedValue({ ok: false, commandResponse: cmd });
		mockIsExtensionInstalled.mockResolvedValue(false);

		const { user } = renderView();
		await triggerFailedSave(user);

		expect(
			await screen.findByText(/the extension is required to edit playlists/i),
		).toBeTruthy();
		const installLink = screen.getByRole("link", {
			name: /install extension/i,
		});
		expect(installLink.getAttribute("href")).toContain(
			"chrome.google.com/webstore/detail/hearted-spotify-sync",
		);
		expect(installLink.getAttribute("target")).toBe("_blank");
	});

	it("renders generic failed message for other errors", async () => {
		const cmd: CommandResponse<{ revision: string }> = {
			ok: false,
			errorCode: "UPSTREAM_ERROR",
			message: "spotify 500",
			retryable: true,
			commandId: "c1",
		};
		mockUpdate.mockResolvedValue({ ok: false, commandResponse: cmd });

		const { user } = renderView();
		await triggerFailedSave(user);

		expect(
			await screen.findByText(
				/description update failed\. please try again\./i,
			),
		).toBeTruthy();
		expect(screen.queryByRole("link", { name: /reconnect/i })).toBeNull();
		expect(
			screen.queryByRole("link", { name: /install extension/i }),
		).toBeNull();
	});
});
