/**
 * The flag-playlists tour derives its step from observable demo state. A hard
 * refresh keeps the flagged set (sessionStorage) but drops the in-memory tour
 * flags, so the provider must not restart the forced "concept" block on a resume
 * that already has flagged playlists — that step's only advance, the Next button,
 * lives in the Matching shelf's empty state and is gone once a restored playlist
 * sits there, soft-locking the page. Each test imports the tour (and its store)
 * fresh so sessionStorage hydration re-runs, mirroring a real reload.
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@/test/utils/render";

const FLAGGED_KEY = "hearted:demo:flagged-playlists";
const METADATA_KEY = "hearted:demo:playlist-metadata";

async function loadTour() {
	return import("../playlistPreviewTour");
}

function seedFlagged(ids: string[]) {
	window.sessionStorage.setItem(FLAGGED_KEY, JSON.stringify(ids));
}

function seedIntent(id: string, intent: string) {
	const raw = window.sessionStorage.getItem(METADATA_KEY);
	const current = raw ? JSON.parse(raw) : {};
	current[id] = { intent, genres: [] };
	window.sessionStorage.setItem(METADATA_KEY, JSON.stringify(current));
}

async function renderStepProbe() {
	const { PlaylistPreviewTourProvider, usePlaylistTourStep } = await loadTour();
	function Probe() {
		const { step, focusPlaylistId } = usePlaylistTourStep();
		return (
			<>
				<span data-testid="step">{step}</span>
				<span data-testid="focus">{focusPlaylistId ?? ""}</span>
			</>
		);
	}
	render(
		<PlaylistPreviewTourProvider>
			<Probe />
		</PlaylistPreviewTourProvider>,
	);
}

async function renderInteractiveProbe() {
	const {
		PlaylistPreviewTourProvider,
		usePlaylistTourReporter,
		usePlaylistTourStep,
	} = await loadTour();
	function Probe() {
		const { step, focusPlaylistId } = usePlaylistTourStep();
		const { reportPanelOpen } = usePlaylistTourReporter();
		return (
			<>
				<span data-testid="step">{step}</span>
				<span data-testid="focus">{focusPlaylistId ?? ""}</span>
				<button type="button" onClick={() => reportPanelOpen("2")}>
					Open 2
				</button>
			</>
		);
	}
	render(
		<PlaylistPreviewTourProvider>
			<Probe />
		</PlaylistPreviewTourProvider>,
	);
}

beforeEach(() => {
	window.sessionStorage.clear();
	vi.resetModules();
});

afterEach(() => {
	window.sessionStorage.clear();
});

describe("PlaylistPreviewTourProvider resume", () => {
	it("starts at the forced concept step on a fresh slate", async () => {
		await renderStepProbe();

		await waitFor(() =>
			expect(screen.getByTestId("step").textContent).toBe("concept"),
		);
	});

	it("focuses the flagged playlist's intent (not 'add more') when a refresh restored one with no saved intent", async () => {
		// The user added a playlist but reloaded before writing its intent. The resume
		// must skip the un-advanceable concept block and force that playlist's intent —
		// opening its panel — never invite adding more or hand off falsely.
		seedFlagged(["2"]);
		await renderStepProbe();

		await waitFor(() =>
			expect(screen.getByTestId("step").textContent).toBe("intent-intro"),
		);
		expect(screen.getByTestId("focus").textContent).toBe("2");
	});

	it("releases to the done state when a refresh restored a flagged playlist whose intent was already saved", async () => {
		// Finished the first cycle (added + described one), reloaded while flagging the
		// rest on their own — the persisted intent is the durable proof, so they land
		// back on the self-driven state, not the forced cycle.
		seedFlagged(["2"]);
		seedIntent("2", "late-night focus");
		await renderStepProbe();

		await waitFor(() =>
			expect(screen.getByTestId("step").textContent).toBe("done"),
		);
		expect(screen.getByTestId("focus").textContent).toBe("");
	});

	it("focuses the still-undescribed playlist when a refresh restored some described and some not", async () => {
		// One described, one not: don't release on count — force the undescribed one's
		// intent before the user can move on.
		seedFlagged(["2", "5"]);
		seedIntent("2", "late-night focus");
		await renderStepProbe();

		await waitFor(() =>
			expect(screen.getByTestId("step").textContent).toBe("intent-intro"),
		);
		expect(screen.getByTestId("focus").textContent).toBe("5");
	});

	it("stays on the add step when the open pending playlist is removed from matching", async () => {
		const store = await import("../demoSandboxStore");
		seedFlagged(["2"]);
		await renderInteractiveProbe();

		await waitFor(() =>
			expect(screen.getByTestId("step").textContent).toBe("intent-intro"),
		);
		screen.getByRole("button", { name: "Open 2" }).click();

		act(() => {
			store.setFlaggedPlaylistIds([]);
		});

		await waitFor(() =>
			expect(screen.getByTestId("step").textContent).toBe("add"),
		);
		expect(screen.getByTestId("focus").textContent).toBe("");
	});
});
