/**
 * PlaylistsLayer's account-mismatch branch (README invariant 2) — the
 * UI-level half of the two-layer defense against writing to the wrong
 * Spotify account. Verifies AccountMismatchPrompt replaces the suggestion
 * rows (and their Add buttons) instead of rendering alongside them.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionSpotifyProfile } from "@/lib/extension/detect";
import { SongDetailPanelSurface } from "../SongDetailPanelSurface";
import type { PlaylistsPanel, SongDetail } from "../song-detail-types";

// AccountMismatchPrompt reads useQueryClient (repairConnection's cache
// invalidation), so the mismatch-branch test needs a provider in scope.
function makeQueryClient() {
	return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithQuery(ui: ReactElement) {
	return render(
		<QueryClientProvider client={makeQueryClient()}>{ui}</QueryClientProvider>,
	);
}

// Minimal SongDetail fixture with a lyrical read — PlaylistsLayer only
// renders inside the `song.read` branch (see SongDetailPanelSurface.tsx).
function makeDetail(overrides: Partial<SongDetail> = {}): SongDetail {
	return {
		id: "track-1",
		spotifyTrackId: "spotify-1",
		title: "Saw You for the First Time",
		artist: "Laurence Guy",
		album: "Found a Place",
		genres: [],
		audioFeatures: { tempo: null, energy: null, valence: null },
		theme: "green",
		displayState: "analyzed",
		contentFetchStatus: "lyrics",
		read: {
			image: "the long way home, alone this time",
			lens: "license as eulogy",
			tension: "Aching Disbelief",
			take: "She passed the test she swore she would pass for him.",
			contradiction: null,
			arc: [],
			lines: [{ line: "I got my driver's license like I told you I would" }],
			texture: "A ballad that grows a spine.",
		},
		instrumentalRead: null,
		...overrides,
	};
}

function makeMismatchProfile(
	overrides?: Partial<ExtensionSpotifyProfile>,
): ExtensionSpotifyProfile {
	return {
		spotifyId: "sp-mismatch",
		displayName: "Someone Else",
		avatarUrl: null,
		...overrides,
	};
}

function makePlaylists(overrides?: Partial<PlaylistsPanel>): PlaylistsPanel {
	return {
		matches: [
			{ playlistId: "pl-1", name: "Chill Vibes", score: 0.82 },
			{ playlistId: "pl-2", name: "Late Night Drive", score: 0.75 },
		],
		addedTo: [],
		reconnectNeeded: false,
		mismatch: null,
		onRecheck: vi.fn(async () => {}),
		onAdd: vi.fn(),
		...overrides,
	};
}

describe("SongDetailPanelSurface — PlaylistsLayer account mismatch guard (invariant 2)", () => {
	it("renders AccountMismatchPrompt instead of playlist rows when playlists.mismatch is set", () => {
		const playlists = makePlaylists({
			mismatch: { extensionProfile: makeMismatchProfile() },
		});
		renderWithQuery(
			<SongDetailPanelSurface song={makeDetail()} playlists={playlists} />,
		);

		expect(screen.getByRole("status")).toBeInTheDocument();
		expect(screen.getByText(/Switch Spotify account/i)).toBeInTheDocument();
		// PlaylistRow's Add button's accessible name is "Add to {playlist name}"
		// (aria-label), not "Add" — match the row-level affordance, not the label text.
		expect(screen.queryAllByRole("button", { name: /^Add to/ })).toHaveLength(
			0,
		);
		expect(screen.queryByText("Chill Vibes")).toBeNull();
		expect(screen.queryByText("Late Night Drive")).toBeNull();
	});

	it("renders playlist rows (no AccountMismatchPrompt) when playlists.mismatch is absent", () => {
		const playlists = makePlaylists({ mismatch: null });
		renderWithQuery(
			<SongDetailPanelSurface song={makeDetail()} playlists={playlists} />,
		);

		expect(screen.queryByRole("status")).toBeNull();
		expect(screen.queryByText(/Switch Spotify account/i)).toBeNull();
		expect(screen.getByText("Chill Vibes")).toBeInTheDocument();
		expect(screen.getByText("Late Night Drive")).toBeInTheDocument();
		expect(screen.queryAllByRole("button", { name: /^Add to/ })).toHaveLength(
			2,
		);
	});
});
