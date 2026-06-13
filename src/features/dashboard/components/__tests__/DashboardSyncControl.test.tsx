/**
 * Tests for DashboardSyncControl — the pure presentation of each sync UI state.
 * Orchestration lives in useDashboardSync (tested separately); here we only
 * assert each discriminated state renders the right CTA/status and that
 * actionable states delegate clicks to onAction.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	DashboardSyncUiState,
	ErrorAction,
} from "@/features/dashboard/hooks/useDashboardSync";
import type { ExtensionSyncState } from "@/lib/extension/detect";
import { render, screen, userEvent } from "@/test/utils/render";
import { DashboardSyncControl } from "../DashboardSyncControl";

function makeSync(overrides?: Partial<ExtensionSyncState>): ExtensionSyncState {
	return {
		status: "syncing",
		phase: "likedSongs",
		fetched: 0,
		total: 0,
		likedSongs: { fetched: 0, total: 0 },
		playlists: { fetched: 0, total: 0 },
		playlistTracks: { fetched: 0, total: 0 },
		artistImages: { fetched: 0, total: 0 },
		lastSyncAt: null,
		error: null,
		...overrides,
	};
}

function renderState(state: DashboardSyncUiState, onAction = vi.fn()) {
	const result = render(
		<DashboardSyncControl state={state} onAction={onAction} />,
	);
	return { ...result, onAction };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("DashboardSyncControl", () => {
	it("renders an install CTA that delegates to onAction", async () => {
		const { onAction } = renderState({ kind: "install-required" });
		const button = screen.getByRole("button", { name: /install extension/i });
		await userEvent.click(button);
		expect(onAction).toHaveBeenCalledTimes(1);
	});

	it("renders a Spotify reconnect CTA that delegates to onAction", async () => {
		const { onAction } = renderState({ kind: "spotify-reconnect-required" });
		const button = screen.getByRole("button", { name: /reconnect spotify/i });
		await userEvent.click(button);
		expect(onAction).toHaveBeenCalledTimes(1);
	});

	it("renders a Sync CTA when ready and delegates clicks", async () => {
		const { onAction } = renderState({ kind: "ready", lastSyncAt: null });
		await userEvent.click(screen.getByRole("button", { name: /^sync$/i }));
		expect(onAction).toHaveBeenCalledTimes(1);
	});

	it("renders the live phase label and percent while syncing", () => {
		renderState({
			kind: "syncing",
			sync: makeSync({ phase: "likedSongs", fetched: 320, total: 1280 }),
		});
		expect(screen.getByText(/reading your liked songs/i)).toBeInTheDocument();
		expect(screen.getByText(/25%/)).toBeInTheDocument();
	});

	it("renders each live phase with its own label", () => {
		const cases: Array<[ExtensionSyncState["phase"], RegExp]> = [
			["playlists", /looking through your playlists/i],
			["playlistTracks", /listening to what's inside/i],
			["artistImages", /getting to know the artists/i],
			["uploading", /sending it to hearted/i],
		];
		for (const [phase, matcher] of cases) {
			const { unmount } = renderState({
				kind: "syncing",
				sync: makeSync({ phase }),
			});
			expect(screen.getByText(matcher)).toBeInTheDocument();
			unmount();
		}
	});

	it("renders a non-retriggerable status when a sync is already running", () => {
		renderState({ kind: "already-running" });
		expect(screen.getByText(/sync in progress/i)).toBeInTheDocument();
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});

	it("renders a blocked countdown during cooldown", () => {
		renderState({ kind: "cooldown", retryAfterSeconds: 42 });
		expect(screen.getByText(/try again in 42s/i)).toBeInTheDocument();
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});

	it("renders the success state", () => {
		renderState({ kind: "success", syncedAt: Date.now() });
		expect(screen.getByText(/up to date/i)).toBeInTheDocument();
	});

	it("renders a passive status while checking and triggering", () => {
		const { unmount } = renderState({ kind: "checking" });
		expect(screen.getByText(/checking/i)).toBeInTheDocument();
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
		unmount();

		renderState({ kind: "triggering" });
		expect(screen.getByText(/starting/i)).toBeInTheDocument();
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});

	it("maps each error cause to the right recovery CTA", () => {
		const labelByAction: Record<ErrorAction, RegExp> = {
			retry: /^retry$/i,
			install: /install extension/i,
		};
		for (const action of ["retry", "install"] as ErrorAction[]) {
			const { unmount } = renderState({
				kind: "error",
				message: "boom",
				retryable: true,
				action,
			});
			expect(
				screen.getByRole("button", { name: labelByAction[action] }),
			).toBeInTheDocument();
			unmount();
		}
	});

	it("invokes onAction when an error CTA is clicked", async () => {
		const { onAction } = renderState({
			kind: "error",
			message: "boom",
			retryable: true,
			action: "retry",
		});
		await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));
		expect(onAction).toHaveBeenCalledTimes(1);
	});
});
