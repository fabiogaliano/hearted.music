import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KeyboardShortcutProvider } from "@/lib/keyboard/KeyboardShortcutProvider";
import { CoverFlowPlaylists } from "../CoverFlowPlaylists";
import type { PlaylistSummary } from "../types";

function summary(id: string, isTarget: boolean): PlaylistSummary {
	return {
		id,
		name: `Playlist ${id}`,
		isTarget,
		songCount: 10,
		imageUrl: null,
		intent: null,
		genres: [],
		matchFilters: { version: 1 },
	};
}

const PLAYLISTS: PlaylistSummary[] = [
	summary("m1", true),
	summary("m2", true),
	summary("lib", false),
];

function mount(props: { detailOpen?: boolean; onOpen: (id: string) => void }) {
	return render(
		<KeyboardShortcutProvider>
			<CoverFlowPlaylists
				playlists={PLAYLISTS}
				onOpen={props.onOpen}
				detailOpen={props.detailOpen}
			/>
		</KeyboardShortcutProvider>,
	);
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("CoverFlowPlaylists keyboard gating", () => {
	it("opens the centered candidate on Enter from the bare list", () => {
		const onOpen = vi.fn();
		mount({ onOpen });

		fireEvent.keyDown(window, { key: "Enter" });

		expect(onOpen).toHaveBeenCalledWith("m1");
	});

	it("moves the cover flow with l before opening", () => {
		const onOpen = vi.fn();
		mount({ onOpen });

		fireEvent.keyDown(window, { key: "l" });
		fireEvent.keyDown(window, { key: "Enter" });

		expect(onOpen).toHaveBeenCalledWith("m2");
	});

	it("ignores keyboard nav while the detail panel is open", () => {
		const onOpen = vi.fn();
		mount({ onOpen, detailOpen: true });

		fireEvent.keyDown(window, { key: "l" });
		fireEvent.keyDown(window, { key: "Enter" });

		expect(onOpen).not.toHaveBeenCalled();
	});

	it("ignores keyboard nav while searching", () => {
		const onOpen = vi.fn();
		const { getByLabelText } = mount({ onOpen });

		fireEvent.change(getByLabelText("Search playlists"), {
			target: { value: "Playlist" },
		});
		fireEvent.keyDown(window, { key: "Enter" });

		expect(onOpen).not.toHaveBeenCalled();
	});
});
