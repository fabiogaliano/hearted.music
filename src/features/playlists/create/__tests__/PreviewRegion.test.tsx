/**
 * Screen-level preview-region test.
 *
 * Mounting the full StudioScreen would drag in the router, extension gate,
 * and every server-fn-backed config panel (see PlaybackCoordination.test.tsx
 * for the same tradeoff); this harness instead reproduces the preview region's
 * wiring — deriveStudioPreviewState plus the exhaustive switch in
 * StudioScreen.renderPreviewSurface — so the real bugs stay covered: manual
 * pins vanishing behind LibraryEmptyState because the gate was keyed on
 * totalEligible instead of the tracklist, and a failed request rendering as
 * "nothing matches". If that region's branching changes, update this harness
 * alongside it.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SongVM } from "@/lib/domains/playlists/types";
import { LibraryEmptyState } from "../LibraryEmptyState";
import { NotEnoughSongsNote } from "../NotEnoughSongsNote";
import { PreviewFailedState } from "../PreviewFailedState";
import { PreviewList } from "../preview/PreviewList";
import { PreviewListSkeleton } from "../preview/PreviewListSkeleton";
import {
	deriveStudioPreviewState,
	type StudioPreviewStateInput,
} from "../studioPreviewState";

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

const settled: StudioPreviewStateInput["query"] = {
	isError: false,
	isLoading: false,
	isPlaceholderData: false,
};

/** Mirrors StudioScreen's preview region. */
function PreviewRegionHarness({
	tracklist,
	totalEligible,
	query = settled,
	maxSongs,
	onRetry = vi.fn(),
}: {
	tracklist: SongVM[];
	totalEligible: number;
	query?: StudioPreviewStateInput["query"];
	maxSongs: number;
	onRetry?: () => void;
}) {
	const previewState = deriveStudioPreviewState({
		query,
		tracklistLength: tracklist.length,
		totalEligible,
		committedMaxSongs: maxSongs,
		retry: onRetry,
	});
	const eligibleShortfall =
		previewState.kind === "empty" || previewState.kind === "ready"
			? previewState.eligibleShortfall
			: null;

	function renderPreviewSurface() {
		switch (previewState.kind) {
			case "loading":
				return <PreviewListSkeleton />;
			case "failed":
				return <PreviewFailedState onRetry={previewState.retry} />;
			case "empty":
				return <LibraryEmptyState />;
			case "ready":
				return (
					<PreviewList
						songs={tracklist}
						isLoading={previewState.isRefreshing}
						onRemoveSong={vi.fn()}
						onRestoreSong={vi.fn()}
					/>
				);
		}
	}

	return (
		<div>
			{(tracklist.length > 0 || totalEligible > 0) && (
				<span>
					{tracklist.length} selected · {totalEligible} match filters
				</span>
			)}

			{renderPreviewSurface()}

			{eligibleShortfall !== null && (
				<NotEnoughSongsNote totalEligible={eligibleShortfall} maxSongs={15} />
			)}
		</div>
	);
}

describe("StudioScreen preview region", () => {
	it("renders the tracklist and the count span when manual pins survive totalEligible === 0", () => {
		// Regression: a pin that's filter-exempt (preview.ts's manualExtras) can
		// populate the tracklist even when totalEligible is 0. The list must not
		// be swapped for the empty state, and the header must still report both
		// (deliberately separate) numbers.
		render(
			<PreviewRegionHarness
				tracklist={[makeSong("s1", "Pinned Song")]}
				totalEligible={0}
				maxSongs={15}
			/>,
		);

		expect(screen.getByText("Pinned Song")).toBeInTheDocument();
		expect(
			screen.getByText("1 selected · 0 match filters"),
		).toBeInTheDocument();
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
	});

	it("shows the plain empty state when the tracklist is genuinely empty and settled", () => {
		render(
			<PreviewRegionHarness tracklist={[]} totalEligible={0} maxSongs={15} />,
		);

		expect(screen.getByRole("status")).toBeInTheDocument();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		// Nothing meaningful to report yet — the count span stays hidden.
		expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
	});

	it("shows the skeleton, not the empty state, while an empty tracklist is still loading", () => {
		render(
			<PreviewRegionHarness
				tracklist={[]}
				totalEligible={0}
				query={{ ...settled, isLoading: true }}
				maxSongs={15}
			/>,
		);

		// The skeleton is the only status region with an accessible name.
		expect(
			screen.getByRole("status", { name: /loading/i }),
		).toBeInTheDocument();
		expect(screen.getAllByRole("status")).toHaveLength(1);
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	// Regression: 2026-10-21 a killed preview request rendered "Nothing matches".
	it("shows a retryable failure, never the empty state, when the preview request failed", async () => {
		const onRetry = vi.fn();
		render(
			<PreviewRegionHarness
				tracklist={[]}
				totalEligible={0}
				query={{ ...settled, isError: true }}
				maxSongs={15}
				onRetry={onRetry}
			/>,
		);

		expect(screen.queryByRole("status")).not.toBeInTheDocument();
		const alert = screen.getByRole("alert");
		await userEvent.click(screen.getByRole("button", { name: /try again/i }));
		expect(alert).toBeInTheDocument();
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it("keeps the shortfall note coherent: hidden when pins survive with totalEligible === 0", () => {
		render(
			<PreviewRegionHarness
				tracklist={[makeSong("s1", "Pinned Song")]}
				totalEligible={0}
				maxSongs={15}
			/>,
		);

		expect(screen.queryByRole("note")).not.toBeInTheDocument();
	});

	it("shows the shortfall note when fewer songs match than asked for", () => {
		render(
			<PreviewRegionHarness
				tracklist={[makeSong("s1", "One"), makeSong("s2", "Two")]}
				totalEligible={2}
				maxSongs={15}
			/>,
		);

		expect(screen.getByRole("note")).toBeInTheDocument();
	});
});
