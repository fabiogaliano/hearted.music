/**
 * Tests for CreateBar, PartialState, and SuccessState.
 *
 * CreateBar is fully presentational now (see usePublishPlaylist for the
 * publish lifecycle) — no orchestrator import, no submit-payload or
 * result-mapping tests here; those live in usePublishPlaylist.test.ts.
 * isSubmitting is driven as a prop.
 *
 * Covers:
 *  - Default name "New playlist" pre-filled in the input.
 *  - CTA disabled when songIds is empty; enabled when songs present.
 *  - CTA disabled when the name is blank (whitespace-only).
 *  - CTA disabled while isSubmitting is true (prop-driven), aria-busy set.
 *  - CTA disabled while isResolvingArtists is true, with the shared
 *    "Updating preview…" hint.
 *  - CTA disabled (harder) on isArtistResolutionError, with its own hint
 *    pointing at the ArtistConfig retry.
 *  - onSubmit called on click when the CTA is enabled.
 *  - gate state extension-unavailable → renders ExtensionUnavailablePrompt.
 *  - gate state reconnect-required → renders ReconnectPrompt / SpotifyReconnectLink.
 *  - gate state account-mismatch → renders AccountMismatchPrompt, never the CTA
 *    (findings 1+2 regression guard).
 */

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CreateBar } from "../publish/CreateBar";

// Mock browser-target so ExtensionUnavailablePrompt renders without navigator.
vi.mock("@/lib/extension/browser-target", () => ({
	getBrowserTarget: () => "chromium",
	getExtensionStoreUrl: () => "https://chromewebstore.google.com/detail/test",
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

import { PartialState } from "../publish/PartialState";
import { SuccessState } from "../publish/SuccessState";
import { UnsyncedState } from "../publish/UnsyncedState";

function makeProps(overrides: Partial<Parameters<typeof CreateBar>[0]> = {}) {
	return {
		name: "New playlist",
		songIds: ["s1", "s2", "s3"],
		isPreviewStale: false,
		isResolvingArtists: false,
		isArtistResolutionError: false,
		isSubmitting: false,
		gateState: "ok" as const,
		onSubmit: vi.fn(),
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

	it("is disabled (and aria-busy) while isSubmitting is true", () => {
		render(<CreateBar {...makeProps({ isSubmitting: true })} />);
		const btn = screen.getByRole("button", { name: /creating…/i });
		expect(btn).toBeDisabled();
		expect(btn).toHaveAttribute("aria-busy", "true");
	});

	it("is disabled while artist song resolution is in flight, with the shared 'Updating preview…' hint", () => {
		// The pinned ids don't reflect the artist selection until resolution
		// lands — submitting here would silently drop that artist's songs.
		render(<CreateBar {...makeProps({ isResolvingArtists: true })} />);
		const btn = screen.getByRole("button", { name: /create playlist/i });
		expect(btn).toBeDisabled();
		expect(screen.getByText("Updating preview…")).toBeInTheDocument();
	});

	it("renders a Retry button instead of the CTA on artist resolution error", () => {
		const onRetry = vi.fn();
		render(
			<CreateBar
				{...makeProps({
					isArtistResolutionError: true,
					onRetryArtistResolution: onRetry,
				})}
			/>,
		);
		expect(
			screen.queryByRole("button", { name: /create playlist/i }),
		).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
	});

	it("is enabled again once isSubmitting flips back to false — the stuck-CTA fix", () => {
		const { rerender } = render(
			<CreateBar {...makeProps({ isSubmitting: true })} />,
		);
		expect(screen.getByRole("button", { name: /creating…/i })).toBeDisabled();

		rerender(<CreateBar {...makeProps({ isSubmitting: false })} />);
		expect(
			screen.getByRole("button", { name: /create playlist/i }),
		).not.toBeDisabled();
	});
});

describe("CreateBar — onSubmit", () => {
	it("calls onSubmit when the CTA is clicked", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		render(<CreateBar {...makeProps({ onSubmit })} />);
		await user.click(screen.getByRole("button", { name: /create playlist/i }));
		expect(onSubmit).toHaveBeenCalledTimes(1);
	});

	it("does not call onSubmit when the CTA is disabled", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		render(<CreateBar {...makeProps({ onSubmit, songIds: [] })} />);
		await user.click(screen.getByRole("button", { name: /create playlist/i }));
		expect(onSubmit).not.toHaveBeenCalled();
	});
});

describe("CreateBar — gate states disable the CTA", () => {
	it("disables the CTA when gate is extension-unavailable", () => {
		render(
			<CreateBar {...makeProps({ gateState: "extension-unavailable" })} />,
		);
		const btn = screen.getByRole("button", { name: /create playlist/i });
		expect(btn).toBeDisabled();
	});

	it("disables the CTA when gate is reconnect-required", () => {
		render(<CreateBar {...makeProps({ gateState: "reconnect-required" })} />);
		const btn = screen.getByRole("button", { name: /create playlist/i });
		expect(btn).toBeDisabled();
	});

	it("disables the CTA when gate is account-mismatch", () => {
		render(<CreateBar {...makeProps({ gateState: "account-mismatch" })} />);
		const btn = screen.getByRole("button", { name: /create playlist/i });
		expect(btn).toBeDisabled();
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
			<UnsyncedState
				spotifyId="abc123"
				isRetrying={false}
				onRetry={vi.fn()}
				retryBlocked={false}
			/>,
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
			<UnsyncedState
				spotifyId="abc123"
				isRetrying={false}
				onRetry={onRetry}
				retryBlocked={false}
			/>,
		);
		await user.click(screen.getByRole("button", { name: /retry/i }));
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it("disables Retry (aria-busy) while a retry is in flight", () => {
		render(
			<UnsyncedState
				spotifyId="abc123"
				isRetrying={true}
				onRetry={vi.fn()}
				retryBlocked={false}
			/>,
		);
		const btn = screen.getByRole("button", { name: /retrying/i });
		expect(btn).toBeDisabled();
		expect(btn).toHaveAttribute("aria-busy", "true");
	});

	it("links to the correct Spotify playlist URL", () => {
		render(
			<UnsyncedState
				spotifyId="abc123"
				isRetrying={false}
				onRetry={vi.fn()}
				retryBlocked={false}
			/>,
		);
		expect(
			screen.getByRole("link", { name: /open in spotify/i }),
		).toHaveAttribute("href", "https://open.spotify.com/playlist/abc123");
	});

	it("blocks Retry while the extension account is mismatched (invariant 2)", () => {
		const onRetry = vi.fn();
		render(
			<UnsyncedState
				spotifyId="abc123"
				isRetrying={false}
				onRetry={onRetry}
				retryBlocked={true}
			/>,
		);
		const btn = screen.getByRole("button", { name: /retry/i });
		expect(btn).toBeDisabled();
		fireEvent.click(btn);
		expect(onRetry).not.toHaveBeenCalled();
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
});
