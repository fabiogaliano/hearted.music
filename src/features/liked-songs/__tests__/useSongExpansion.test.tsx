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
	selectedSlug,
	fallbackSelectedSong,
	isSelectedSlugResolved,
}: {
	songs: LikedSong[];
	selectedSlug?: string | null;
	fallbackSelectedSong?: LikedSong | null;
	isSelectedSlugResolved?: boolean;
}) {
	const { selectedSongId, selectedSong, isExpanded } = useSongExpansion(songs, {
		selectedSlug,
		fallbackSelectedSong,
		isSelectedSlugResolved,
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
	navigateMock.mockReset();
	cleanup();
});

describe("useSongExpansion", () => {
	it("initializes the deep-linked song during the first render", () => {
		const song = createSong();
		const slug = generateSongSlug(song.track.artist, song.track.name);

		render(<HookHarness songs={[song]} selectedSlug={slug} />);

		expect(screen.getByTestId("selected-song-id")).toHaveTextContent(
			song.track.id,
		);
		expect(screen.getByTestId("selected-song-name")).toHaveTextContent(
			song.track.name,
		);
		expect(screen.getByTestId("is-expanded")).toHaveTextContent("true");
	});

	it("opens the deep-linked song from direct lookup when it is not in loaded pages", () => {
		const song = createSong({
			id: "song-2",
			spotify_track_id: "spotify-song-2",
			artist: "A L E X",
			name: "Proud of You",
		});
		const slug = generateSongSlug(song.track.artist, song.track.name);

		render(
			<HookHarness
				songs={[]}
				selectedSlug={slug}
				fallbackSelectedSong={song}
				isSelectedSlugResolved
			/>,
		);

		expect(screen.getByTestId("selected-song-id")).toHaveTextContent(
			song.track.id,
		);
		expect(screen.getByTestId("selected-song-name")).toHaveTextContent(
			song.track.name,
		);
		expect(screen.getByTestId("is-expanded")).toHaveTextContent("true");
	});

	it("stays closed when the deep-linked slug resolves to no song", () => {
		render(
			<HookHarness
				songs={[]}
				selectedSlug="unknown-song"
				isSelectedSlugResolved
			/>,
		);

		expect(screen.getByTestId("selected-song-id")).toHaveTextContent("none");
		expect(screen.getByTestId("is-expanded")).toHaveTextContent("false");
	});

	it("opens the deep-linked song after songs load", () => {
		const song = createSong();
		const slug = generateSongSlug(song.track.artist, song.track.name);
		const { rerender } = render(<HookHarness songs={[]} selectedSlug={slug} />);

		expect(screen.getByTestId("selected-song-id")).toHaveTextContent("none");
		expect(screen.getByTestId("is-expanded")).toHaveTextContent("false");

		rerender(<HookHarness songs={[song]} selectedSlug={slug} />);

		expect(screen.getByTestId("selected-song-id")).toHaveTextContent(
			song.track.id,
		);
		expect(screen.getByTestId("is-expanded")).toHaveTextContent("true");
	});

	it("updates selection when the URL song changes", () => {
		const firstSong = createSong();
		const secondSong = createSong({
			id: "song-2",
			spotify_track_id: "spotify-song-2",
			name: "Supercut",
		});
		const firstSlug = generateSongSlug(
			firstSong.track.artist,
			firstSong.track.name,
		);
		const secondSlug = generateSongSlug(
			secondSong.track.artist,
			secondSong.track.name,
		);
		const { rerender } = render(
			<HookHarness songs={[firstSong, secondSong]} selectedSlug={firstSlug} />,
		);

		rerender(
			<HookHarness songs={[firstSong, secondSong]} selectedSlug={secondSlug} />,
		);

		expect(screen.getByTestId("selected-song-id")).toHaveTextContent(
			secondSong.track.id,
		);
		expect(screen.getByTestId("selected-song-name")).toHaveTextContent(
			secondSong.track.name,
		);
	});

	it("closes when the URL song is removed", () => {
		const song = createSong();
		const slug = generateSongSlug(song.track.artist, song.track.name);
		const { rerender } = render(
			<HookHarness songs={[song]} selectedSlug={slug} />,
		);

		rerender(<HookHarness songs={[song]} selectedSlug={null} />);

		expect(screen.getByTestId("selected-song-id")).toHaveTextContent("none");
		expect(screen.getByTestId("is-expanded")).toHaveTextContent("false");
	});
});
