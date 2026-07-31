import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PublishResultRegion } from "../publish/PublishResultRegion";
import type { PublishPlaylistResult } from "../usePublishPlaylist";

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	Link: ({ children, ...props }: { children: ReactNode; href?: string }) => (
		<a {...props}>{children}</a>
	),
}));

const successResult: PublishPlaylistResult = {
	status: "success",
	playlistUri: "spotify:playlist:success",
	spotifyId: "success",
	playlistId: "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7",
	playlistName: "Night Mix",
};

const partialResult: PublishPlaylistResult = {
	status: "partial",
	playlistUri: "spotify:playlist:partial",
	spotifyId: "partial",
	playlistId: "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7",
	failedTrackCount: 2,
};

const unsyncedResult: PublishPlaylistResult = {
	status: "created-unsynced",
	playlistUri: "spotify:playlist:unsynced",
	spotifyId: "unsynced",
};

function renderRegion(result: PublishPlaylistResult) {
	return render(
		<PublishResultRegion
			result={result}
			isRetryingUnsynced={false}
			onRetryUnsynced={vi.fn()}
			retryUnsyncedBlocked={false}
		/>,
	);
}

describe("PublishResultRegion", () => {
	it.each([
		[successResult, "Playlist created"],
		[partialResult, "Playlist created — songs couldn't be added"],
		[unsyncedResult, "Created, not synced back"],
	] as const)("focuses each terminal result when it appears", (result, copy) => {
		renderRegion(result);

		const region = screen.getByRole("status");
		expect(region).toHaveFocus();
		expect(screen.getByText(copy, { exact: true })).toBeInTheDocument();
	});

	it("moves focus back to the region when the terminal status changes", () => {
		const { rerender } = renderRegion(unsyncedResult);
		const retry = screen.getByRole("button", { name: "Retry" });
		retry.focus();
		expect(retry).toHaveFocus();

		rerender(
			<PublishResultRegion
				result={successResult}
				isRetryingUnsynced={false}
				onRetryUnsynced={vi.fn()}
				retryUnsyncedBlocked={false}
			/>,
		);

		expect(screen.getByRole("status")).toHaveFocus();
	});

	it("disables the created-unsynced Retry while the extension account is mismatched", () => {
		render(
			<PublishResultRegion
				result={unsyncedResult}
				isRetryingUnsynced={false}
				onRetryUnsynced={vi.fn()}
				retryUnsyncedBlocked={true}
			/>,
		);

		expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
	});
});
