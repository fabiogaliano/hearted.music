import { describe, expect, it, vi } from "vitest";
import { MatchModeToggle } from "@/features/matching/components/MatchModeToggle";
import type { MatchViewMode } from "@/features/matching/types";
import { render, screen } from "@/test/utils/render";

function renderToggle({
	mode = "song" as MatchViewMode,
	disabled = false,
	onModeChange = vi.fn(),
}: {
	mode?: MatchViewMode;
	disabled?: boolean;
	onModeChange?: (mode: MatchViewMode) => void;
} = {}) {
	return render(
		<MatchModeToggle
			mode={mode}
			disabled={disabled}
			onModeChange={onModeChange}
		/>,
	);
}

describe("MatchModeToggle", () => {
	it("renders Song and Playlist buttons in a labelled group", () => {
		renderToggle();
		expect(screen.getByRole("group", { name: "View mode" })).toBeDefined();
		expect(screen.getByRole("button", { name: "Song" })).toBeDefined();
		expect(screen.getByRole("button", { name: "Playlist" })).toBeDefined();
	});

	it("marks the active mode with aria-pressed", () => {
		renderToggle({ mode: "playlist" });
		expect(
			screen
				.getByRole("button", { name: "Playlist" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen.getByRole("button", { name: "Song" }).getAttribute("aria-pressed"),
		).toBe("false");
	});

	it("calls onModeChange when the non-current mode is activated", async () => {
		const onModeChange = vi.fn();
		const { user } = renderToggle({ mode: "song", onModeChange });
		await user.click(screen.getByRole("button", { name: "Playlist" }));
		expect(onModeChange).toHaveBeenCalledExactlyOnceWith("playlist");
	});

	it("is a no-op when the already-current mode is activated", async () => {
		const onModeChange = vi.fn();
		const { user } = renderToggle({ mode: "song", onModeChange });
		await user.click(screen.getByRole("button", { name: "Song" }));
		expect(onModeChange).not.toHaveBeenCalled();
	});

	it("disables both buttons and does not navigate when disabled", async () => {
		const onModeChange = vi.fn();
		const { user } = renderToggle({ disabled: true, onModeChange });
		expect(
			(screen.getByRole("button", { name: "Song" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		expect(
			(screen.getByRole("button", { name: "Playlist" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		await user.click(screen.getByRole("button", { name: "Playlist" }));
		expect(onModeChange).not.toHaveBeenCalled();
	});
});
