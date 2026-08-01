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
 *  - gate state extension-unavailable → renders ExtensionUnavailablePrompt
 *    (browser-specific install link + a working "Check again" recheck), never
 *    the dead-end CTA.
 *  - gate state reconnect-required → renders ReconnectPrompt, which repairs
 *    via repairConnection({ kind: "spotify-disconnected" }) (opens Spotify
 *    *and* re-pairs — the fresh-install case).
 *  - gate state account-mismatch → renders AccountMismatchPrompt with the
 *    mismatched-account copy, never the CTA, and repairs via
 *    repairConnection({ kind: "mismatch", extensionProfile }) — which must
 *    never re-pair while the wrong Spotify identity is active (invariant 2),
 *    even when artist resolution has independently failed.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateBar } from "../publish/CreateBar";
import type { SpotifyGateStatus } from "../useSpotifyGate";

// Mock browser-target so ExtensionUnavailablePrompt renders without navigator.
vi.mock("@/lib/extension/browser-target", () => ({
	getBrowserTarget: () => "chromium",
	getExtensionStoreUrl: () => "https://chromewebstore.google.com/detail/test",
}));

// ReconnectPrompt/AccountMismatchPrompt repair through repairConnection, which
// in turn calls these two — mocked (not repairConnection itself) so the tests
// exercise the real verdict branching in repair.ts, mirroring
// ExtensionAccountBanner.test.tsx's pattern for the same primitive.
const mockExpectLoginReturn = vi.fn();
const mockPairExtension = vi.fn();

vi.mock("@/lib/extension/detect", () => ({
	expectLoginReturn: (armToken: string) => mockExpectLoginReturn(armToken),
}));

vi.mock("@/lib/extension/connect", () => ({
	pairExtension: () => mockPairExtension(),
}));

let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	mockExpectLoginReturn.mockReset().mockResolvedValue(true);
	mockPairExtension.mockReset().mockResolvedValue({ ok: true });
	openSpy = vi.spyOn(window, "open").mockReturnValue(null);
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ReconnectPrompt/AccountMismatchPrompt read the QueryClient via
// useQueryClient (repairConnection invalidates the connection query on
// re-pair) — a bare render() has no provider, so only the tests that render
// those two prompts need this wrapper.
function renderWithQueryClient(ui: ReactElement) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
	);
}

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

const SONG_STUBS: Parameters<typeof CreateBar>[0]["songs"] = [
	{
		id: "s1",
		spotifyId: "sp1",
		name: "A",
		artist: "X",
		album: null,
		imageUrl: null,
		genres: [],
		durationMs: null,
	},
	{
		id: "s2",
		spotifyId: "sp2",
		name: "B",
		artist: "Y",
		album: null,
		imageUrl: null,
		genres: [],
		durationMs: null,
	},
	{
		id: "s3",
		spotifyId: "sp3",
		name: "C",
		artist: "Z",
		album: null,
		imageUrl: null,
		genres: [],
		durationMs: null,
	},
];

function makeProps(overrides: Partial<Parameters<typeof CreateBar>[0]> = {}) {
	return {
		name: "New playlist",
		songs: [...SONG_STUBS],
		isPreviewStale: false,
		isResolvingArtists: false,
		isArtistResolutionError: false,
		isSubmitting: false,
		gate: { gateState: "ok" } as SpotifyGateStatus,
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
		render(<CreateBar {...makeProps({ songs: [] })} />);
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

	it("is disabled while artist song resolution is in flight, with an 'Updating…' hint", () => {
		render(<CreateBar {...makeProps({ isResolvingArtists: true })} />);
		const btn = screen.getByRole("button", { name: /create playlist/i });
		expect(btn).toBeDisabled();
		expect(screen.getByText("Updating…")).toBeInTheDocument();
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
		render(<CreateBar {...makeProps({ onSubmit, songs: [] })} />);
		await user.click(screen.getByRole("button", { name: /create playlist/i }));
		expect(onSubmit).not.toHaveBeenCalled();
	});
});

describe("CreateBar — extension-unavailable is a real recovery path, not a dead end", () => {
	it("replaces the CTA with an Install link and a Check again action, no bare 'Connect'", () => {
		render(
			<CreateBar
				{...makeProps({ gate: { gateState: "extension-unavailable" } })}
			/>,
		);
		expect(
			screen.queryByRole("button", { name: /create playlist/i }),
		).not.toBeInTheDocument();
		// Browser-specific extension-store URL — mocked getExtensionStoreUrl above.
		expect(screen.getByRole("link", { name: /install/i })).toHaveAttribute(
			"href",
			"https://chromewebstore.google.com/detail/test",
		);
		expect(
			screen.getByRole("button", { name: /check again/i }),
		).toBeInTheDocument();
	});

	it("calls onRecheck when Check again is clicked", async () => {
		const user = userEvent.setup();
		const onRecheck = vi.fn().mockResolvedValue(undefined);
		render(
			<CreateBar
				{...makeProps({
					gate: { gateState: "extension-unavailable" },
					onRecheck,
				})}
			/>,
		);
		await user.click(screen.getByRole("button", { name: /check again/i }));
		expect(onRecheck).toHaveBeenCalledTimes(1);
	});
});

describe("CreateBar — reconnect-required repairs with the spotify-disconnected verdict", () => {
	it("replaces the CTA with Reconnect Spotify, which opens Spotify login *and* re-pairs — the fresh-install case (both credentials gone) resolves in one click", async () => {
		const user = userEvent.setup();
		renderWithQueryClient(
			<CreateBar
				{...makeProps({ gate: { gateState: "reconnect-required" } })}
			/>,
		);
		expect(
			screen.queryByRole("button", { name: /create playlist/i }),
		).not.toBeInTheDocument();
		await user.click(
			screen.getByRole("button", { name: /reconnect spotify/i }),
		);
		expect(openSpy).toHaveBeenCalledTimes(1);
		expect(mockPairExtension).toHaveBeenCalledTimes(1);
	});
});

describe("CreateBar — account-mismatch repairs with the mismatch verdict, never the CTA", () => {
	const mismatchProfile = {
		spotifyId: "wrong-id",
		displayName: "alex@work",
		avatarUrl: null,
	};

	it("shows which Spotify identity is signed in and which account this library belongs to, and never the CTA", () => {
		renderWithQueryClient(
			<CreateBar
				{...makeProps({
					gate: { gateState: "account-mismatch", mismatchProfile },
					accountDisplayName: "fabio",
				})}
			/>,
		);
		expect(screen.getByText(/alex@work/)).toBeInTheDocument();
		expect(screen.getByText(/fabio/)).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /create playlist/i }),
		).not.toBeInTheDocument();
	});

	it("keeps the mismatch recovery visible when artist resolution also fails", () => {
		renderWithQueryClient(
			<CreateBar
				{...makeProps({
					isArtistResolutionError: true,
					gate: { gateState: "account-mismatch", mismatchProfile },
					accountDisplayName: "fabio",
				})}
			/>,
		);

		expect(screen.getByText(/alex@work/)).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /retry/i }),
		).not.toBeInTheDocument();
	});

	it("opens Spotify login but never re-pairs — pairing can't fix a wrong Spotify identity (invariant 2, the bug this fix closes)", async () => {
		const user = userEvent.setup();
		renderWithQueryClient(
			<CreateBar
				{...makeProps({
					gate: { gateState: "account-mismatch", mismatchProfile },
					accountDisplayName: "fabio",
				})}
			/>,
		);
		await user.click(
			screen.getByRole("button", { name: /switch spotify account/i }),
		);
		expect(openSpy).toHaveBeenCalledTimes(1);
		expect(mockPairExtension).not.toHaveBeenCalled();
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
