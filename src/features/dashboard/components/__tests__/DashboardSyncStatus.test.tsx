/**
 * Regression pin: the last-sync phrase and a live status used to render side by
 * side, concatenating into sentences nobody wrote — "Nothing synced yet up to
 * date" (a contradiction), "Never looking through your playlists". The two are
 * alternatives, not neighbours: any state reporting the present makes the
 * last-sync time stale.
 *
 * Asserted through DashboardSyncStatus rather than rendersActionOnly directly,
 * because the bug is what the user reads, not how the predicate answers.
 */

import { describe, expect, it, vi } from "vitest";
import type { DashboardSyncUiState } from "@/features/dashboard/hooks/useDashboardSync";
import { render, screen } from "@/test/utils/render";
import { DashboardSyncStatus } from "../DashboardSyncStatus";

const mockUseDashboardSync = vi.fn();

vi.mock("../../hooks/useDashboardSync", () => ({
	useDashboardSync: () => mockUseDashboardSync(),
}));

function renderWithState(
	state: DashboardSyncUiState,
	lastSyncText: string | null = "Synced 2 hours ago",
) {
	mockUseDashboardSync.mockReturnValue({ state, onAction: vi.fn() });
	return render(
		<DashboardSyncStatus
			accountId="acct-1"
			lastSyncText={lastSyncText}
			verdict={{ kind: "ok" }}
			linkedSpotifyId="spotify-1"
		/>,
	);
}

describe("DashboardSyncStatus — last-sync phrase never sits beside live status", () => {
	it.each<{ label: string; state: DashboardSyncUiState }>([
		{
			label: "syncing",
			state: {
				kind: "syncing",
				sync: {
					status: "syncing",
					phase: "playlists",
					fetched: 3,
					total: 20,
					likedSongs: { fetched: 0, total: 0 },
					playlists: { fetched: 3, total: 20 },
					playlistTracks: { fetched: 0, total: 0 },
					artistImages: { fetched: 0, total: 0 },
					lastSyncAt: null,
					error: null,
				},
			},
		},
		{ label: "success", state: { kind: "success", syncedAt: Date.now() } },
		{ label: "paused", state: { kind: "paused" } },
		{ label: "checking", state: { kind: "checking" } },
		{ label: "already-running", state: { kind: "already-running" } },
		{ label: "triggering", state: { kind: "triggering" } },
		{ label: "cooldown", state: { kind: "cooldown", retryAfterSeconds: 30 } },
		{
			label: "error",
			state: {
				kind: "error",
				message: "HTTP 500",
				retryable: true,
				action: "retry",
			},
		},
	])("hides it while the control reports the present ($label)", ({ state }) => {
		renderWithState(state);
		expect(screen.queryByText(/synced 2 hours ago/i)).not.toBeInTheDocument();
	});

	it.each<{ label: string; state: DashboardSyncUiState }>([
		{ label: "ready", state: { kind: "ready", lastSyncAt: null } },
		{ label: "install-required", state: { kind: "install-required" } },
		{
			label: "spotify-reconnect-required",
			state: { kind: "spotify-reconnect-required" },
		},
	])("shows it when the control is a bare button ($label)", ({ state }) => {
		renderWithState(state);
		expect(screen.getByText(/synced 2 hours ago/i)).toBeInTheDocument();
	});

	// lastSyncAt is null for three different situations — a sync in flight, one
	// that failed, and a genuine never — so any phrase here asserts one of them
	// while being wrong about the other two. Guards against a fallback string
	// creeping back in ("Never", "Nothing synced yet"): the whole row must read
	// as nothing but the action.
	it("says nothing at all when no sync has completed", () => {
		renderWithState({ kind: "ready", lastSyncAt: null }, null);
		// The row itself, not `container` — the render helper injects a theme
		// <style> block whose text would swamp the assertion.
		const row = screen.getByRole("button", {
			name: /sync new songs/i,
		}).parentElement;
		expect(row?.textContent?.trim()).toBe("Sync new songs");
	});
});
