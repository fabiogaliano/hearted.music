import { describe, expect, it } from "vitest";
import { computePosition } from "../components/usePlaylistTrackPreview";

const DESKTOP = { width: 1440, height: 900 };

describe("computePosition", () => {
	it("opens to the right of the anchor when there's room", () => {
		const pos = computePosition({ top: 300, left: 400, right: 460 }, DESKTOP);

		expect(pos.placeLeft).toBe(false);
		expect(pos.left).toBe(460 + 12);
		// Top-aligned to the anchor, not offset below a cursor.
		expect(pos.top).toBe(300);
	});

	it("flips to the left of the anchor near the right edge", () => {
		const pos = computePosition({ top: 300, left: 1360, right: 1420 }, DESKTOP);

		expect(pos.placeLeft).toBe(true);
		expect(pos.left).toBe(1360 - 12 - pos.width);
	});

	it("clamps within the viewport horizontally", () => {
		// A near-full-width anchor forces a left flip that would run off-screen.
		const pos = computePosition({ top: 300, left: 100, right: 1439 }, DESKTOP);

		expect(pos.placeLeft).toBe(true);
		expect(pos.left).toBe(8);
		expect(pos.left).toBeGreaterThanOrEqual(8);
		expect(pos.left).toBeLessThanOrEqual(DESKTOP.width - 8 - pos.width);
	});

	it("clamps the top so a tall card never runs off the bottom", () => {
		const viewport = { width: 1440, height: 600 };
		const pos = computePosition({ top: 580, left: 400, right: 460 }, viewport);

		expect(pos.top).toBe(viewport.height - 8 - pos.maxHeight);
		expect(pos.top).toBeGreaterThanOrEqual(8);
	});

	it("shrinks the card width on narrow viewports", () => {
		const viewport = { width: 320, height: 700 };
		const pos = computePosition({ top: 100, left: 10, right: 60 }, viewport);

		expect(pos.width).toBe(320 - 16);
	});
});
