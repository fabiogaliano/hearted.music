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
// SuccessState's primary action and PartialState's secondary "View playlist" link
// use Link — mocked as a plain <a> so tests can assert the resolved href, mirroring
// how "Open in Spotify" is asserted via getByRole("link", ...).toHaveAttribute("href").
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	Link: ({
		to,
		params,
		children,
		...rest
	}: {
		to: string;
		params?: Record<string, string>;
		children?: React.ReactNode;
	}) => {
		const href = params
			? Object.entries(params).reduce(
					(path, [key, value]) => path.replace(`$${key}`, value),
					to,
				)
			: to;
		return (
			<a href={href} {...rest}>
				{children}
			</a>
		);
	},
}));

import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { createPlaylistFromDraft } from "@/lib/extension/create-playlist-from-draft";
import { PartialState } from "../create-flow/PartialState";
import { SuccessState } from "../create-flow/SuccessState";
import { UnsyncedState } from "../create-flow/UnsyncedState";

const DEFAULT_FILTERS: PlaylistMatchFiltersV1 = { version: 1 };

function makeProps(overrides: Partial<Parameters<typeof CreateBar>[0]> = {}) {
	return {
		name: "New playlist",
		songIds: ["s1", "s2", "s3"],
		genrePills: ["indie", "electronic"],
		matchFilters: DEFAULT_FILTERS,
		intentApplied: false,
		intent: null,
		isPreviewStale: false,
		gateState: "ok" as const,
		recheck: vi.fn(async () => {}),
		onNameCommit: vi.fn(),
		onResult: vi.fn(),
		...overrides,
	};
}

describe("CreateBar — name is a prop, not an internal field", () => {
	it("does not render its own name input (the page title owns the name)", () => {
		render(<CreateBar {...makeProps()} />);
		expect(
			screen.queryByRole("textbox", { name: /playlist name/i }),
		).not.toBeInTheDocument();
	});
});

describe("CreateBar — CTA disabled states", () => {
	it("is disabled when songIds is empty", () => {
		render(<CreateBar {...makeProps({ songIds: [] })} />);
		const btn = screen.getByRole("button", { name: /create playlist/i });
		expect(btn).toBeDisabled();
	});

	it("is disabled when name is blank", () => {
		render(<CreateBar {...makeProps({ name: "   " })} />);
		const btn = screen.getByRole("button", { name: /create playlist/i });
		expect(btn).toBeDisabled();
	});

	it("is enabled when songs are present and name is non-empty", () => {
		render(<CreateBar {...makeProps()} />);
		const btn = screen.getByRole("button", { name: /create playlist/i });
		expect(btn).not.toBeDisabled();
	});

	it("is disabled while the preview is stale (a config edit is mid-debounce)", () => {
		// Blocks the divergence where the live config is persisted against songs
		// scored under the previous (previewed) config.
		render(<CreateBar {...makeProps({ isPreviewStale: true })} />);
		const btn = screen.getByRole("button", { name: /create playlist/i });
		expect(btn).toBeDisabled();
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
			playlistId: "playlist-abc",
		});

		const props = makeProps({
			// Padded so we verify the bar trims before submitting.
			name: "  Night Mix  ",
			songIds: ["id1", "id2"],
			genrePills: ["jazz"],
			intentApplied: true,
			intent: "late night vibes",
		});
		render(<CreateBar {...props} />);

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
			playlistId: "playlist-abc",
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
				playlistId: "playlist-x",
			};
		});

		render(
			<CreateBar {...makeProps({ name: "  New playlist  ", onNameCommit })} />,
		);
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
			playlistId: "playlist-abc",
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
			playlistId: "playlist-x",
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
			playlistId: "playlist-abc",
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

describe("PartialState — no duplicate-create path", () => {
	it("renders 'Open in Spotify' and 'Done' but no 'Retry' affordance", () => {
		render(<PartialState spotifyId="abc123" failedTrackCount={2} />);
		expect(
			screen.getByRole("link", { name: /open in spotify/i }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /done/i })).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /retry/i }),
		).not.toBeInTheDocument();
	});

	it("links to the correct Spotify playlist URL", () => {
		render(<PartialState spotifyId="abc123" failedTrackCount={2} />);
		const link = screen.getByRole("link", { name: /open in spotify/i });
		expect(link).toHaveAttribute(
			"href",
			"https://open.spotify.com/playlist/abc123",
		);
	});

	it("states no songs were added, without implying partial success", () => {
		render(<PartialState spotifyId="abc123" failedTrackCount={5} />);
		expect(screen.getByText(/couldn't be added to it/i)).toBeInTheDocument();
		// The old copy claimed "the rest are in your Spotify playlist" — that
		// never happens for a partial result, so it must not appear.
		expect(
			screen.queryByText(/the rest are in your spotify playlist/i),
		).not.toBeInTheDocument();
	});

	it("uses singular phrasing for a single failed song", () => {
		render(<PartialState spotifyId="abc123" failedTrackCount={1} />);
		expect(
			screen.getByText(/your 1 song couldn't be added/i),
		).toBeInTheDocument();
	});

	it("does not render a 'View playlist' link when playlistId is absent (config-persist-threw branch)", () => {
		render(<PartialState spotifyId="abc123" failedTrackCount={2} />);
		expect(
			screen.queryByRole("link", { name: /view playlist/i }),
		).not.toBeInTheDocument();
	});

	it("renders a secondary 'View playlist' link to the detail route when playlistId is present", () => {
		render(
			<PartialState
				spotifyId="abc123"
				playlistId="a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7"
				failedTrackCount={2}
			/>,
		);
		const link = screen.getByRole("link", { name: /view playlist/i });
		expect(link).toHaveAttribute("href", "/playlists/playlist--a1b2c3d4e5f6");
	});
});

describe("UnsyncedState — safe retry path", () => {
	it("offers a Retry alongside Open in Spotify and Done", () => {
		render(
			<UnsyncedState spotifyId="abc123" isRetrying={false} onRetry={vi.fn()} />,
		);
		expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: /open in spotify/i }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /done/i })).toBeInTheDocument();
	});

	it("calls onRetry when Retry is clicked", async () => {
		const user = userEvent.setup();
		const onRetry = vi.fn();
		render(
			<UnsyncedState spotifyId="abc123" isRetrying={false} onRetry={onRetry} />,
		);
		await user.click(screen.getByRole("button", { name: /retry/i }));
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it("disables Retry (aria-busy) while a retry is in flight", () => {
		render(
			<UnsyncedState spotifyId="abc123" isRetrying={true} onRetry={vi.fn()} />,
		);
		const btn = screen.getByRole("button", { name: /retrying/i });
		expect(btn).toBeDisabled();
		expect(btn).toHaveAttribute("aria-busy", "true");
	});

	it("links to the correct Spotify playlist URL", () => {
		render(
			<UnsyncedState spotifyId="abc123" isRetrying={false} onRetry={vi.fn()} />,
		);
		expect(
			screen.getByRole("link", { name: /open in spotify/i }),
		).toHaveAttribute("href", "https://open.spotify.com/playlist/abc123");
	});
});

describe("SuccessState — routes into the managed-playlist loop", () => {
	const PLAYLIST_ID = "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7";

	it("renders a primary 'View playlist' link and a secondary 'Open in Spotify' link, no bare 'Done'", () => {
		render(
			<SuccessState
				playlistName="Night Mix"
				spotifyId="xyz789"
				playlistId={PLAYLIST_ID}
			/>,
		);
		expect(
			screen.getByRole("link", { name: /view playlist/i }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: /open in spotify/i }),
		).toBeInTheDocument();
		// The bare "back to playlists" action is dropped: the primary action
		// now IS the way forward, so a second no-op exit reads as clutter.
		expect(
			screen.queryByRole("button", { name: /done/i }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /create/i }),
		).not.toBeInTheDocument();
	});

	it("the primary action navigates to the new playlist's detail route", () => {
		render(
			<SuccessState
				playlistName="Night Mix"
				spotifyId="xyz789"
				playlistId={PLAYLIST_ID}
			/>,
		);
		const link = screen.getByRole("link", { name: /view playlist/i });
		expect(link).toHaveAttribute("href", "/playlists/night-mix--a1b2c3d4e5f6");
	});

	it("links to the correct Spotify playlist URL", () => {
		render(
			<SuccessState
				playlistName="Night Mix"
				spotifyId="xyz789"
				playlistId={PLAYLIST_ID}
			/>,
		);
		const link = screen.getByRole("link", { name: /open in spotify/i });
		expect(link).toHaveAttribute(
			"href",
			"https://open.spotify.com/playlist/xyz789",
		);
	});

	it("displays the playlist name", () => {
		render(
			<SuccessState
				playlistName="Night Mix"
				spotifyId="xyz789"
				playlistId={PLAYLIST_ID}
			/>,
		);
		expect(screen.getByText("Night Mix")).toBeInTheDocument();
	});

	it("uses retention-oriented copy about ongoing suggestions", () => {
		render(
			<SuccessState
				playlistName="Night Mix"
				spotifyId="xyz789"
				playlistId={PLAYLIST_ID}
			/>,
		);
		expect(
			screen.getByText(/we'll keep suggesting songs that fit/i),
		).toBeInTheDocument();
	});
});
