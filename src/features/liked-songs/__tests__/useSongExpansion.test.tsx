import { describe, expect, it } from "vitest";
import { generateSongSlug } from "@/lib/domains/library/songs/slug";
import {
	fireEvent,
	renderWithRouter,
	screen,
	waitFor,
} from "@/test/utils/render";
import { useSongExpansion } from "../hooks/useSongExpansion";
import type { LikedSong } from "../types";

function createSong(overrides?: Partial<LikedSong["track"]>): LikedSong {
	return {
		liked_at: "2026-03-30T00:00:00Z",
		matching_status: null,
		displayState: "analyzed",
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
	const { selectedSongId, selectedSong, isExpanded, hasNext, hasPrevious } =
		useSongExpansion(songs, {
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
			<div data-testid="has-next">{String(hasNext)}</div>
			<div data-testid="has-previous">{String(hasPrevious)}</div>
		</div>
	);
}

function InteractiveHookHarness({
	songs,
	selectedSlug,
	targetSong,
}: {
	songs: LikedSong[];
	selectedSlug?: string | null;
	targetSong: LikedSong;
}) {
	const { selectedSongId, handleExpand } = useSongExpansion(songs, {
		selectedSlug,
	});

	return (
		<div>
			<div data-testid="selected-song-id">{selectedSongId ?? "none"}</div>
			<button
				type="button"
				onClick={(event) => handleExpand(targetSong, event.currentTarget)}
			>
				Open target song
			</button>
		</div>
	);
}

describe("useSongExpansion", () => {
	it("initializes the deep-linked song during the first render", async () => {
		const song = createSong();
		const slug = generateSongSlug(song.track.artist, song.track.name);

		await renderWithRouter(<HookHarness songs={[song]} selectedSlug={slug} />);

		expect(screen.getByTestId("selected-song-id")).toHaveTextContent(
			song.track.id,
		);
		expect(screen.getByTestId("selected-song-name")).toHaveTextContent(
			song.track.name,
		);
		expect(screen.getByTestId("is-expanded")).toHaveTextContent("true");
	});

	it("enables prev/next when the deep-linked song is present in the loaded list", async () => {
		const previous = createSong({ id: "song-prev", name: "Tennis Court" });
		const selected = createSong({ id: "song-sel", name: "Ribs" });
		const next = createSong({ id: "song-next", name: "Team" });
		const slug = generateSongSlug(selected.track.artist, selected.track.name);

		await renderWithRouter(
			<HookHarness songs={[previous, selected, next]} selectedSlug={slug} />,
		);

		expect(screen.getByTestId("selected-song-id")).toHaveTextContent(
			selected.track.id,
		);
		// The song has a real index in the list, so panel navigation is live.
		expect(screen.getByTestId("has-previous")).toHaveTextContent("true");
		expect(screen.getByTestId("has-next")).toHaveTextContent("true");
	});

	it("disables prev/next for a fallback-only deep-linked song", async () => {
		const selected = createSong({ id: "song-sel", name: "Ribs" });
		const slug = generateSongSlug(selected.track.artist, selected.track.name);

		await renderWithRouter(
			<HookHarness
				songs={[]}
				selectedSlug={slug}
				fallbackSelectedSong={selected}
				isSelectedSlugResolved
			/>,
		);

		expect(screen.getByTestId("selected-song-id")).toHaveTextContent(
			selected.track.id,
		);
		// Resolved outside the list (index -1), so there is nothing to navigate to.
		expect(screen.getByTestId("has-previous")).toHaveTextContent("false");
		expect(screen.getByTestId("has-next")).toHaveTextContent("false");
	});

	it("opens the deep-linked song from direct lookup when it is not in loaded pages", async () => {
		const song = createSong({
			id: "song-2",
			spotify_track_id: "spotify-song-2",
			artist: "A L E X",
			name: "Proud of You",
		});
		const slug = generateSongSlug(song.track.artist, song.track.name);

		await renderWithRouter(
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

	it("stays closed when the deep-linked slug resolves to no song", async () => {
		await renderWithRouter(
			<HookHarness
				songs={[]}
				selectedSlug="unknown-song"
				isSelectedSlugResolved
			/>,
		);

		expect(screen.getByTestId("selected-song-id")).toHaveTextContent("none");
		expect(screen.getByTestId("is-expanded")).toHaveTextContent("false");
	});

	it("opens the deep-linked song after songs load", async () => {
		const song = createSong();
		const slug = generateSongSlug(song.track.artist, song.track.name);
		const { rerender } = await renderWithRouter(
			<HookHarness songs={[]} selectedSlug={slug} />,
		);

		expect(screen.getByTestId("selected-song-id")).toHaveTextContent("none");
		expect(screen.getByTestId("is-expanded")).toHaveTextContent("false");

		await rerender(<HookHarness songs={[song]} selectedSlug={slug} />);

		expect(screen.getByTestId("selected-song-id")).toHaveTextContent(
			song.track.id,
		);
		expect(screen.getByTestId("is-expanded")).toHaveTextContent("true");
	});

	it("updates selection when the URL song changes", async () => {
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
		const { rerender } = await renderWithRouter(
			<HookHarness songs={[firstSong, secondSong]} selectedSlug={firstSlug} />,
		);

		await rerender(
			<HookHarness songs={[firstSong, secondSong]} selectedSlug={secondSlug} />,
		);

		expect(screen.getByTestId("selected-song-id")).toHaveTextContent(
			secondSong.track.id,
		);
		expect(screen.getByTestId("selected-song-name")).toHaveTextContent(
			secondSong.track.name,
		);
	});

	it("keeps the locally selected song while the router is still catching up", async () => {
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
		const { rerender, router } = await renderWithRouter(
			<InteractiveHookHarness
				songs={[firstSong, secondSong]}
				selectedSlug={firstSlug}
				targetSong={secondSong}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Open target song" }));

		expect(screen.getByTestId("selected-song-id")).toHaveTextContent(
			secondSong.track.id,
		);
		await waitFor(() =>
			expect(router.state.location.search).toEqual({ song: secondSlug }),
		);

		await rerender(
			<InteractiveHookHarness
				songs={[firstSong, secondSong]}
				selectedSlug={secondSlug}
				targetSong={secondSong}
			/>,
		);

		expect(screen.getByTestId("selected-song-id")).toHaveTextContent(
			secondSong.track.id,
		);
	});

	it("closes when the URL song is removed", async () => {
		const song = createSong();
		const slug = generateSongSlug(song.track.artist, song.track.name);
		const { rerender } = await renderWithRouter(
			<HookHarness songs={[song]} selectedSlug={slug} />,
		);

		await rerender(<HookHarness songs={[song]} selectedSlug={null} />);

		expect(screen.getByTestId("selected-song-id")).toHaveTextContent("none");
		expect(screen.getByTestId("is-expanded")).toHaveTextContent("false");
	});
});
