import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateSongSlug } from "@/lib/utils/slug";
import { useSongExpansion } from "../hooks/useSongExpansion";
import type { LikedSong } from "../types";

const navigateMock = vi.fn();

vi.mock("@tanstack/react-router", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
		"@tanstack/react-router",
	);

	return {
		...actual,
		useNavigate: () => navigateMock,
	};
});

function createSong(overrides?: Partial<LikedSong["track"]>): LikedSong {
	return {
		liked_at: "2026-03-30T00:00:00Z",
		matching_status: null,
		uiAnalysisStatus: "analyzed",
		analysis: null,
		track: {
			id: "song-1",
			spotify_track_id: "spotify-song-1",
			name: "Ribs",
			artist: "Lorde",
			artist_id: "artist-1",
			artist_image_url: null,
			album: "Pure Heroine",
			image_url: null,
			genres: [],
			audio_features: null,
			...overrides,
		},
	};
}

function HookHarness({
	songs,
	initialSlug,
}: {
	songs: LikedSong[];
	initialSlug?: string | null;
}) {
	const { selectedSongId, selectedSong, isExpanded } = useSongExpansion(songs, {
		initialSlug,
	});

	return (
		<div>
			<div data-testid="selected-song-id">{selectedSongId ?? "none"}</div>
			<div data-testid="selected-song-name">
				{selectedSong?.track.name ?? "none"}
			</div>
			<div data-testid="is-expanded">{String(isExpanded)}</div>
		</div>
	);
}

afterEach(() => {
	cleanup();
});

describe("useSongExpansion", () => {
	it("initializes the deep-linked song during the first render", () => {
		const song = createSong();
		const slug = generateSongSlug(song.track.artist, song.track.name);

		render(<HookHarness songs={[song]} initialSlug={slug} />);

		expect(screen.getByTestId("selected-song-id")).toHaveTextContent(
			song.track.id,
		);
		expect(screen.getByTestId("selected-song-name")).toHaveTextContent(
			song.track.name,
		);
		expect(screen.getByTestId("is-expanded")).toHaveTextContent("true");
	});

	it("stays closed when the deep-linked slug does not match a song", () => {
		const song = createSong();

		render(<HookHarness songs={[song]} initialSlug="unknown-song" />);

		expect(screen.getByTestId("selected-song-id")).toHaveTextContent("none");
		expect(screen.getByTestId("is-expanded")).toHaveTextContent("false");
	});
});
