/**
 * Screen-level preview-region test.
 *
 * Mounting the full CreatePlaylistScreen would drag in the router, extension
 * gate, and every server-fn-backed config panel (see PlaybackCoordination.test.tsx
 * for the same tradeoff); this harness instead reproduces the exact wiring of
 * the preview region (CreatePlaylistScreen.tsx, the "Preview" section ~350-410
 * plus the tracklistIsEmpty/isWarming/showNotEnoughNote derivations ~228-243)
 * so the real bug — manual pins vanishing behind LibraryEmptyState because the
 * gate was keyed on totalEligible instead of the tracklist — stays covered. If
 * that region's branching changes, update this harness alongside it.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SongVM } from "@/lib/domains/playlists/types";
import { LibraryEmptyState } from "../create-flow/LibraryEmptyState";
import { NotEnoughSongsNote } from "../create-flow/NotEnoughSongsNote";
import { PreviewList } from "../preview/PreviewList";

const makeSong = (id: string, name: string): SongVM => ({
	id,
	spotifyId: `spotify-${id}`,
	name,
	artist: "Test Artist",
	album: "Test Album",
	imageUrl: null,
	genres: ["indie"],
	durationMs: 200000,
	matchScore: 0.8,
});

/** Mirrors CreatePlaylistScreen's preview region exactly (post-fix). */
function PreviewRegionHarness({
	tracklist,
	totalEligible,
	isLoading,
	maxSongs,
}: {
	tracklist: SongVM[];
	totalEligible: number;
	isLoading: boolean;
	maxSongs: number;
}) {
	const tracklistIsEmpty = tracklist.length === 0;
	const isWarming = tracklistIsEmpty && isLoading;
	const showNotEnoughNote =
		totalEligible > 0 && totalEligible < maxSongs && !isLoading;

	return (
		<div>
			{(!tracklistIsEmpty || totalEligible > 0) && (
				<span>
					{tracklist.length} selected · {totalEligible} match filters
				</span>
			)}

			{tracklistIsEmpty ? (
				<LibraryEmptyState isWarming={isWarming} />
			) : (
				<PreviewList
					songs={tracklist}
					isLoading={isLoading}
					onRemoveSong={vi.fn()}
					onRestoreSong={vi.fn()}
				/>
			)}

			{showNotEnoughNote && (
				<NotEnoughSongsNote totalEligible={totalEligible} />
			)}
		</div>
	);
}

describe("CreatePlaylistScreen preview region", () => {
	it("renders the tracklist and the count span when manual pins survive totalEligible === 0", () => {
		// Regression: a pin that's filter-exempt (preview.ts's manualExtras) can
		// populate the tracklist even when totalEligible is 0. The list must not
		// be swapped for the empty state, and the header must still report both
		// (deliberately separate) numbers.
		render(
			<PreviewRegionHarness
				tracklist={[makeSong("s1", "Pinned Song")]}
				totalEligible={0}
				isLoading={false}
				maxSongs={15}
			/>,
		);

		expect(screen.getByText("Pinned Song")).toBeInTheDocument();
		expect(
			screen.getByText("1 selected · 0 match filters"),
		).toBeInTheDocument();
		expect(
			screen.queryByText(/no songs match the current filters/i),
		).not.toBeInTheDocument();
	});

	it("shows the plain empty state when the tracklist is genuinely empty and settled", () => {
		render(
			<PreviewRegionHarness
				tracklist={[]}
				totalEligible={0}
				isLoading={false}
				maxSongs={15}
			/>,
		);

		expect(
			screen.getByText(/no songs match the current filters/i),
		).toBeInTheDocument();
		expect(screen.queryByText(/still warming up/i)).not.toBeInTheDocument();
		// Nothing meaningful to report yet — the count span stays hidden.
		expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
	});

	it("shows the warming variant when the tracklist is empty and still loading", () => {
		render(
			<PreviewRegionHarness
				tracklist={[]}
				totalEligible={0}
				isLoading={true}
				maxSongs={15}
			/>,
		);

		expect(screen.getByText(/still warming up/i)).toBeInTheDocument();
		expect(
			screen.queryByText(/no songs match the current filters/i),
		).not.toBeInTheDocument();
	});

	it("keeps showNotEnoughNote coherent: hidden when pins survive with totalEligible === 0", () => {
		render(
			<PreviewRegionHarness
				tracklist={[makeSong("s1", "Pinned Song")]}
				totalEligible={0}
				isLoading={false}
				maxSongs={15}
			/>,
		);

		expect(screen.queryByRole("note")).not.toBeInTheDocument();
	});

	it("still shows showNotEnoughNote when eligible songs exist but fall short of maxSongs", () => {
		render(
			<PreviewRegionHarness
				tracklist={[makeSong("s1", "Song One"), makeSong("s2", "Song Two")]}
				totalEligible={2}
				isLoading={false}
				maxSongs={15}
			/>,
		);

		expect(screen.getByRole("note")).toHaveTextContent(/only 2 songs match/i);
	});
});
