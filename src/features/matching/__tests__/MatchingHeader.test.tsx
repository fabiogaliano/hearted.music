import { describe, expect, it, vi } from "vitest";
import type { MatchViewMode } from "@/features/matching/types";
import { render, screen } from "@/test/utils/render";
import { MatchingHeader } from "../sections/MatchingHeader";

function makeModeChangeMock(): (mode: MatchViewMode) => void {
	return vi.fn();
}

function renderHeader({
	mode = "song" as const,
	disabled = false,
	onModeChange = makeModeChangeMock(),
}: {
	mode?: MatchViewMode;
	disabled?: boolean;
	onModeChange?: (mode: MatchViewMode) => void;
} = {}) {
	return render(
		<MatchingHeader
			currentIndex={0}
			totalSongs={10}
			mode={mode}
			disabled={disabled}
			onModeChange={onModeChange}
		/>,
	);
}

describe("MatchingHeader toggle", () => {
	it("renders Song and Playlist buttons", () => {
		renderHeader();
		expect(screen.getByRole("button", { name: "Song" })).toBeDefined();
		expect(screen.getByRole("button", { name: "Playlist" })).toBeDefined();
	});

	it("wraps buttons in a group with accessible label", () => {
		renderHeader();
		expect(screen.getByRole("group", { name: "View mode" })).toBeDefined();
	});

	it("sets aria-pressed=true on Song button and false on Playlist in song mode", () => {
		renderHeader({ mode: "song" });
		const songBtn = screen.getByRole("button", { name: "Song" });
		const playlistBtn = screen.getByRole("button", { name: "Playlist" });
		expect(songBtn.getAttribute("aria-pressed")).toBe("true");
		expect(playlistBtn.getAttribute("aria-pressed")).toBe("false");
	});

	it("sets aria-pressed=true on Playlist button and false on Song in playlist mode", () => {
		renderHeader({ mode: "playlist" });
		const songBtn = screen.getByRole("button", { name: "Song" });
		const playlistBtn = screen.getByRole("button", { name: "Playlist" });
		expect(playlistBtn.getAttribute("aria-pressed")).toBe("true");
		expect(songBtn.getAttribute("aria-pressed")).toBe("false");
	});

	it("calls onModeChange with 'playlist' when Playlist button is clicked in song mode", async () => {
		const onModeChange = vi.fn();
		const { user } = renderHeader({ mode: "song", onModeChange });
		await user.click(screen.getByRole("button", { name: "Playlist" }));
		expect(onModeChange).toHaveBeenCalledOnce();
		expect(onModeChange).toHaveBeenCalledWith("playlist");
	});

	it("calls onModeChange with 'song' when Song button is clicked in playlist mode", async () => {
		const onModeChange = vi.fn();
		const { user } = renderHeader({ mode: "playlist", onModeChange });
		await user.click(screen.getByRole("button", { name: "Song" }));
		expect(onModeChange).toHaveBeenCalledOnce();
		expect(onModeChange).toHaveBeenCalledWith("song");
	});

	it("does not call onModeChange when the current mode button is activated", async () => {
		const onModeChange = vi.fn();
		const { user } = renderHeader({ mode: "song", onModeChange });
		// Activating the already-selected Song button must be a no-op.
		await user.click(screen.getByRole("button", { name: "Song" }));
		expect(onModeChange).not.toHaveBeenCalled();
	});

	it("disables both buttons when disabled prop is true", () => {
		renderHeader({ disabled: true });
		const songBtn = screen.getByRole("button", { name: "Song" });
		const playlistBtn = screen.getByRole("button", { name: "Playlist" });
		// HTMLButtonElement.disabled is a native boolean attribute.
		expect((songBtn as HTMLButtonElement).disabled).toBe(true);
		expect((playlistBtn as HTMLButtonElement).disabled).toBe(true);
	});

	it("does not call onModeChange when disabled button is clicked", async () => {
		const onModeChange = vi.fn();
		const { user } = renderHeader({
			mode: "song",
			disabled: true,
			onModeChange,
		});
		// userEvent respects the disabled attribute and does not fire click.
		await user.click(screen.getByRole("button", { name: "Playlist" }));
		expect(onModeChange).not.toHaveBeenCalled();
	});

	it("retains focus on the clicked toggle button (in-isolation baseline; in the full app the route pendingComponent remounts the boundary and focus moves to document.body)", async () => {
		const onModeChange = vi.fn();
		const { user } = renderHeader({ mode: "song", onModeChange });
		const playlistBtn = screen.getByRole("button", { name: "Playlist" });
		await user.click(playlistBtn);
		// In isolation there is no route transition, so focus stays on the button.
		// The accepted app behaviour (focus → body on navigation) is documented in
		// MatchingHeader.tsx next to the onModeChange call.
		expect(document.activeElement).toBe(playlistBtn);
	});

	it("renders progress counter with 1-based index", () => {
		renderHeader({ mode: "song" });
		// currentIndex=0 → displayed as "1" (first span child of the h2)
		expect(screen.getByText("1")).toBeDefined();
		// denominator span has text " / 10" — match via role+name to avoid whitespace fragility
		expect(screen.getByRole("heading", { level: 2 }).textContent).toContain(
			"/ 10",
		);
	});
});
