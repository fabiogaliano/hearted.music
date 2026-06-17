import { describe, expect, it } from "vitest";
import { computePosition } from "../components/usePlaylistTrackPreview";

const DESKTOP = { width: 1440, height: 900 };

describe("computePosition", () => {
	it("opens down-right of the cursor when there's room", () => {
		const pos = computePosition({ x: 400, y: 300 }, DESKTOP);

		expect(pos.placeLeft).toBe(false);
		expect(pos.left).toBe(400 + 12);
		expect(pos.top).toBe(300 + 12);
	});

	it("flips to the left of the cursor near the right edge", () => {
		const pos = computePosition({ x: 1400, y: 300 }, DESKTOP);

		expect(pos.placeLeft).toBe(true);
		expect(pos.left).toBe(1400 - 12 - pos.width);
	});

	it("clamps within the viewport horizontally", () => {
		const pos = computePosition({ x: 1439, y: 300 }, DESKTOP);

		expect(pos.left).toBeGreaterThanOrEqual(8);
		expect(pos.left).toBeLessThanOrEqual(DESKTOP.width - 8 - pos.width);
	});

	it("clamps the top so a tall card never runs off the bottom", () => {
		const viewport = { width: 1440, height: 600 };
		const pos = computePosition({ x: 400, y: 580 }, viewport);

		expect(pos.top).toBe(viewport.height - 8 - pos.maxHeight);
		expect(pos.top).toBeGreaterThanOrEqual(8);
	});

	it("shrinks the card width on narrow viewports", () => {
		const viewport = { width: 320, height: 700 };
		const pos = computePosition({ x: 10, y: 100 }, viewport);

		expect(pos.width).toBe(320 - 16);
	});
});
