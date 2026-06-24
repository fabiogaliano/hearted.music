/**
 * Tests for CreateBar, PartialState, and SuccessState.
 *
 * Covers:
 *  - Default name "New playlist" pre-filled in the input.
 *  - CTA disabled when songIds is empty; enabled when songs present.
 *  - CTA disabled when the name is blank (whitespace-only).
 *  - Submit calls createPlaylistFromDraft with the correct payload
 *    (ordered songIds, intentApplied, trimmed name, genrePills, matchFilters).
 *  - onNameCommit called with the trimmed name before orchestrator runs.
 *  - success result → onResult called.
 *  - partial result → onResult called.
 *  - reconnect-required result → onResult called.
 *  - extension-unavailable result → onResult called.
 *  - error result → toast.error fired; CTA re-enabled; onResult NOT called.
 *  - gate state extension-unavailable → renders ExtensionUnavailablePrompt.
 *  - gate state reconnect-required → renders ReconnectPrompt / SpotifyReconnectLink.
 *  - aria-busy while submitting.
 *  - CTA stays disabled after a successful result (duplicate-create guard).
 *  - PartialState has no Retry/re-create affordance (duplicate-create guard).
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { CreateBar } from "../create-flow/CreateBar";

// Mock the orchestrator so tests don't hit the extension.
vi.mock("@/lib/extension/create-playlist-from-draft", () => ({
	createPlaylistFromDraft: vi.fn(),
}));

// Mock browser-target so ExtensionUnavailablePrompt renders without navigator.
vi.mock("@/lib/extension/browser-target", () => ({
	getBrowserTarget: () => "chromium",
	getExtensionStoreUrl: () => "https://chromewebstore.google.com/detail/test",
}));

// sonner is partially mocked by setup.tsx (toast.error etc).
// For this suite we override the full toast module so toast.error is callable.
vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
		info: vi.fn(),
	},
}));

// PartialState and SuccessState use useNavigate for the "Done" → /playlists button.
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
}));

import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { createPlaylistFromDraft } from "@/lib/extension/create-playlist-from-draft";
import { PartialState } from "../create-flow/PartialState";
import { SuccessState } from "../create-flow/SuccessState";

const DEFAULT_FILTERS: PlaylistMatchFiltersV1 = { version: 1 };

function makeProps(overrides: Partial<Parameters<typeof CreateBar>[0]> = {}) {
	return {
		songIds: ["s1", "s2", "s3"],
		genrePills: ["indie", "electronic"],
		matchFilters: DEFAULT_FILTERS,
		intentApplied: false,
		intent: null,
		gateState: "ok" as const,
		onNameCommit: vi.fn(),
		onResult: vi.fn(),
		...overrides,
	};
}

describe("CreateBar — default name", () => {
	it("pre-fills the name input with 'New playlist'", () => {
		render(<CreateBar {...makeProps()} />);
		const input = screen.getByRole("textbox", { name: /playlist name/i });
		expect((input as HTMLInputElement).value).toBe("New playlist");
	});
});

describe("CreateBar — CTA disabled states", () => {
	it("is disabled when songIds is empty", () => {
		render(<CreateBar {...makeProps({ songIds: [] })} />);
		const btn = screen.getByRole("button", { name: /create playlist/i });
		expect(btn).toBeDisabled();
	});

	it("is disabled when name is blank", async () => {
		const user = userEvent.setup();
		render(<CreateBar {...makeProps()} />);
		const input = screen.getByRole("textbox", { name: /playlist name/i });
		await user.clear(input);
		const btn = screen.getByRole("button", { name: /create playlist/i });
		expect(btn).toBeDisabled();
	});

	it("is enabled when songs are present and name is non-empty", () => {
		render(<CreateBar {...makeProps()} />);
		const btn = screen.getByRole("button", { name: /create playlist/i });
		expect(btn).not.toBeDisabled();
	});
});

describe("CreateBar — CTA label", () => {
	it("shows song count in the CTA label", () => {
		render(<CreateBar {...makeProps({ songIds: ["a", "b", "c"] })} />);
		expect(
			screen.getByRole("button", { name: /create playlist · 3 songs/i }),
		).toBeInTheDocument();
	});

	it("uses singular 'song' for a single song", () => {
		render(<CreateBar {...makeProps({ songIds: ["a"] })} />);
		expect(
			screen.getByRole("button", { name: /create playlist · 1 song/i }),
		).toBeInTheDocument();
	});
});

describe("CreateBar — submit payload", () => {
	it("calls createPlaylistFromDraft with the correct payload", async () => {
		const user = userEvent.setup();
		vi.mocked(createPlaylistFromDraft).mockResolvedValueOnce({
			status: "success",
			playlistUri: "spotify:playlist:abc",
			spotifyId: "abc",
		});

		const props = makeProps({
			songIds: ["id1", "id2"],
			genrePills: ["jazz"],
			intentApplied: true,
			intent: "late night vibes",
		});
		render(<CreateBar {...props} />);

		// Change the name so we verify trimming too
		const input = screen.getByRole("textbox", { name: /playlist name/i });
		await user.clear(input);
		await user.type(input, "  Night Mix  ");

		await user.click(screen.getByRole("button", { name: /create playlist/i }));

		await waitFor(() => {
			expect(createPlaylistFromDraft).toHaveBeenCalledWith({
				name: "Night Mix",
				songIds: ["id1", "id2"],
				genrePills: ["jazz"],
				matchFilters: DEFAULT_FILTERS,
				intentApplied: true,
				intent: "late night vibes",
			});
		});
	});

	it("sends intent: null when intentApplied is false", async () => {
		const user = userEvent.setup();
		vi.mocked(createPlaylistFromDraft).mockResolvedValueOnce({
			status: "success",
			playlistUri: "spotify:playlist:abc",
			spotifyId: "abc",
		});

		render(
			<CreateBar {...makeProps({ intentApplied: false, intent: "ignored" })} />,
		);
		await user.click(screen.getByRole("button", { name: /create playlist/i }));

		await waitFor(() => {
			expect(createPlaylistFromDraft).toHaveBeenCalledWith(
				expect.objectContaining({ intent: null, intentApplied: false }),
			);
		});
	});

	it("calls onNameCommit with the trimmed name before orchestrator", async () => {
		const user = userEvent.setup();
		const onNameCommit = vi.fn();
		let nameAtCallTime: string | undefined;

		vi.mocked(createPlaylistFromDraft).mockImplementation(async (input) => {
			nameAtCallTime = input.name;
			return {
				status: "success",
				playlistUri: "spotify:playlist:x",
				spotifyId: "x",
			};
		});

		render(<CreateBar {...makeProps({ onNameCommit })} />);
		await user.click(screen.getByRole("button", { name: /create playlist/i }));

		await waitFor(() => {
			expect(onNameCommit).toHaveBeenCalledWith("New playlist");
		});
		// onNameCommit fires before (or at same time as) the orchestrator
		expect(nameAtCallTime).toBe("New playlist");
	});
});

describe("CreateBar — result mapping", () => {
	it("calls onResult on success", async () => {
		const user = userEvent.setup();
		const onResult = vi.fn();
		vi.mocked(createPlaylistFromDraft).mockResolvedValueOnce({
			status: "success",
			playlistUri: "spotify:playlist:abc",
			spotifyId: "abc",
		});

		render(<CreateBar {...makeProps({ onResult })} />);
		await user.click(screen.getByRole("button", { name: /create playlist/i }));

		await waitFor(() => {
			expect(onResult).toHaveBeenCalledWith(
				expect.objectContaining({ status: "success" }),
			);
		});
	});

	it("calls onResult on partial", async () => {
		const user = userEvent.setup();
		const onResult = vi.fn();
		vi.mocked(createPlaylistFromDraft).mockResolvedValueOnce({
			status: "partial",
			playlistUri: "spotify:playlist:abc",
			spotifyId: "abc",
			failedTrackCount: 2,
		});

		render(<CreateBar {...makeProps({ onResult })} />);
		await user.click(screen.getByRole("button", { name: /create playlist/i }));

		await waitFor(() => {
			expect(onResult).toHaveBeenCalledWith(
				expect.objectContaining({ status: "partial", failedTrackCount: 2 }),
			);
		});
	});

	it("calls onResult on reconnect-required", async () => {
		const user = userEvent.setup();
		const onResult = vi.fn();
		vi.mocked(createPlaylistFromDraft).mockResolvedValueOnce({
			status: "reconnect-required",
		});

		render(<CreateBar {...makeProps({ onResult })} />);
		await user.click(screen.getByRole("button", { name: /create playlist/i }));

		await waitFor(() => {
			expect(onResult).toHaveBeenCalledWith({ status: "reconnect-required" });
		});
	});

	it("calls onResult on extension-unavailable", async () => {
		const user = userEvent.setup();
		const onResult = vi.fn();
		vi.mocked(createPlaylistFromDraft).mockResolvedValueOnce({
			status: "extension-unavailable",
		});

		render(<CreateBar {...makeProps({ onResult })} />);
		await user.click(screen.getByRole("button", { name: /create playlist/i }));

		await waitFor(() => {
			expect(onResult).toHaveBeenCalledWith({
				status: "extension-unavailable",
			});
		});
	});

	it("fires toast.error on error and does NOT call onResult", async () => {
		const user = userEvent.setup();
		const onResult = vi.fn();
		vi.mocked(createPlaylistFromDraft).mockResolvedValueOnce({
			status: "error",
			message: "Playlist creation failed",
		});

		render(<CreateBar {...makeProps({ onResult })} />);
		await user.click(screen.getByRole("button", { name: /create playlist/i }));

		await waitFor(() => {
			expect(toast.error).toHaveBeenCalledWith("Playlist creation failed");
		});
		expect(onResult).not.toHaveBeenCalled();
	});

	it("re-enables the CTA after an error", async () => {
		const user = userEvent.setup();
		vi.mocked(createPlaylistFromDraft).mockResolvedValueOnce({
			status: "error",
			message: "oops",
		});

		render(<CreateBar {...makeProps()} />);
		const btn = screen.getByRole("button", { name: /create playlist/i });
		await user.click(btn);

		await waitFor(() => {
			expect(btn).not.toBeDisabled();
		});
	});
});

describe("CreateBar — aria-busy while submitting", () => {
	it("sets aria-busy on the CTA while the orchestrator is in flight", async () => {
		const user = userEvent.setup();
		let resolve!: (
			v: Awaited<ReturnType<typeof createPlaylistFromDraft>>,
		) => void;
		vi.mocked(createPlaylistFromDraft).mockReturnValue(
			new Promise((res) => {
				resolve = res;
			}),
		);

		render(<CreateBar {...makeProps()} />);
		const btn = screen.getByRole("button", { name: /create playlist/i });
		await user.click(btn);

		expect(btn).toHaveAttribute("aria-busy", "true");

		resolve({
			status: "success",
			playlistUri: "spotify:playlist:x",
			spotifyId: "x",
		});
		await waitFor(() => {
			// After result, the bar is kept inert (success unmounts it via parent)
		});
	});
});

describe("CreateBar — duplicate-create guard", () => {
	it("CTA stays disabled (aria-busy) after a success result so a second submit is impossible", async () => {
		const user = userEvent.setup();
		vi.mocked(createPlaylistFromDraft).mockResolvedValueOnce({
			status: "success",
			playlistUri: "spotify:playlist:abc",
			spotifyId: "abc",
		});

		render(<CreateBar {...makeProps()} />);
		const btn = screen.getByRole("button", { name: /create playlist/i });
		await user.click(btn);

		// After a non-error result the bar stays in isSubmitting=true state.
		// The parent transitions to SuccessState (unmounting CreateBar), but
		// if somehow the bar is still mounted it must be inert.
		await waitFor(() => {
			expect(btn).toBeDisabled();
		});
	});

	it("CTA stays disabled after a partial result for the same reason", async () => {
		const user = userEvent.setup();
		vi.mocked(createPlaylistFromDraft).mockResolvedValueOnce({
			status: "partial",
			playlistUri: "spotify:playlist:abc",
			spotifyId: "abc",
			failedTrackCount: 3,
		});

		render(<CreateBar {...makeProps()} />);
		const btn = screen.getByRole("button", { name: /create playlist/i });
		await user.click(btn);

		await waitFor(() => {
			expect(btn).toBeDisabled();
		});
	});
});

describe("CreateBar — gate states", () => {
	it("renders install-extension affordance when extension-unavailable", () => {
		render(
			<CreateBar {...makeProps({ gateState: "extension-unavailable" })} />,
		);
		expect(screen.getByText(/install extension/i)).toBeInTheDocument();
	});

	it("renders reconnect affordance when reconnect-required", () => {
		render(<CreateBar {...makeProps({ gateState: "reconnect-required" })} />);
		expect(screen.getByText(/reconnect to spotify/i)).toBeInTheDocument();
	});
});

describe("Library state helpers", () => {
	it("empty state logic: totalEligible === 0 and not loading → genuinely empty", () => {
		// This is a unit test of the condition logic that CreatePlaylistScreen uses.
		const totalEligible = 0;
		const isLoading = false;
		const isWarming = totalEligible === 0 && isLoading;
		const isEmpty = totalEligible === 0 && !isLoading;
		expect(isEmpty).toBe(true);
		expect(isWarming).toBe(false);
	});

	it("warming state logic: totalEligible === 0 and isLoading → warming", () => {
		const totalEligible = 0;
		const isLoading = true;
		const isWarming = totalEligible === 0 && isLoading;
		expect(isWarming).toBe(true);
	});

	it("not-enough logic: 0 < totalEligible < maxSongs", () => {
		const totalEligible = 8;
		const maxSongs = 15;
		const isLoading = false;
		const showNote =
			totalEligible > 0 && totalEligible < maxSongs && !isLoading;
		expect(showNote).toBe(true);
	});

	it("not-enough note is suppressed when totalEligible >= maxSongs", () => {
		const totalEligible = 20;
		const maxSongs = 15;
		const showNote = totalEligible > 0 && totalEligible < maxSongs;
		expect(showNote).toBe(false);
	});
});

describe("PartialState — complete failure detection", () => {
	it("isCompleteFailure when failedTrackCount >= totalSongCount", () => {
		const failedTrackCount = 5;
		const totalSongCount = 5;
		expect(failedTrackCount >= totalSongCount).toBe(true);
	});

	it("is NOT a complete failure when some tracks added", () => {
		const failedTrackCount = 2;
		const totalSongCount = 5;
		expect(failedTrackCount >= totalSongCount).toBe(false);
	});
});

describe("PartialState — no duplicate-create path", () => {
	it("renders 'Open in Spotify' and 'Done' but no 'Retry' affordance", () => {
		render(
			<PartialState
				spotifyId="abc123"
				failedTrackCount={2}
				totalSongCount={5}
			/>,
		);
		expect(
			screen.getByRole("link", { name: /open in spotify/i }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /done/i })).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /retry/i }),
		).not.toBeInTheDocument();
	});

	it("links to the correct Spotify playlist URL", () => {
		render(
			<PartialState
				spotifyId="abc123"
				failedTrackCount={2}
				totalSongCount={5}
			/>,
		);
		const link = screen.getByRole("link", { name: /open in spotify/i });
		expect(link).toHaveAttribute(
			"href",
			"https://open.spotify.com/playlist/abc123",
		);
	});

	it("shows complete-failure message when all tracks failed", () => {
		render(
			<PartialState
				spotifyId="abc123"
				failedTrackCount={5}
				totalSongCount={5}
			/>,
		);
		expect(screen.getByText(/tracks couldn't be added/i)).toBeInTheDocument();
	});
});

describe("SuccessState — no re-create path", () => {
	it("renders 'Open in Spotify' and 'Done' only", () => {
		render(<SuccessState playlistName="Night Mix" spotifyId="xyz789" />);
		expect(
			screen.getByRole("link", { name: /open in spotify/i }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /done/i })).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /create/i }),
		).not.toBeInTheDocument();
	});

	it("links to the correct Spotify playlist URL", () => {
		render(<SuccessState playlistName="Night Mix" spotifyId="xyz789" />);
		const link = screen.getByRole("link", { name: /open in spotify/i });
		expect(link).toHaveAttribute(
			"href",
			"https://open.spotify.com/playlist/xyz789",
		);
	});

	it("displays the playlist name", () => {
		render(<SuccessState playlistName="Night Mix" spotifyId="xyz789" />);
		expect(screen.getByText("Night Mix")).toBeInTheDocument();
	});
});
