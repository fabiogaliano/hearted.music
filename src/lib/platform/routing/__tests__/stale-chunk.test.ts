import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearStaleChunkMarker,
	isStaleChunkError,
	recoverFromStaleChunk,
} from "../stale-chunk";

const reload = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
	window.sessionStorage.clear();
	// jsdom's location.reload is not configurable by assignment.
	Object.defineProperty(window, "location", {
		configurable: true,
		value: { ...window.location, reload },
	});
});

afterEach(() => {
	window.sessionStorage.clear();
});

describe("isStaleChunkError", () => {
	// One per browser: the message wording differs and all three must match.
	it.each([
		"TypeError: error loading dynamically imported module: https://hearted.music/assets/dist-DwgSDvZd.js",
		"TypeError: Failed to fetch dynamically imported module: /assets/match-a1b2.js",
		"TypeError: Importing a module script failed.",
		"TypeError: Unable to preload CSS for /assets/match-a1b2.css",
	])("recognises %s", (message) => {
		expect(isStaleChunkError(new Error(message))).toBe(true);
	});

	it("ignores unrelated errors", () => {
		expect(isStaleChunkError(new Error("NetworkError"))).toBe(false);
		expect(isStaleChunkError(new Error("Cannot read properties of null"))).toBe(
			false,
		);
		expect(isStaleChunkError(null)).toBe(false);
		expect(isStaleChunkError(undefined)).toBe(false);
		expect(isStaleChunkError({})).toBe(false);
	});
});

describe("recoverFromStaleChunk", () => {
	const staleChunkError = new Error(
		"error loading dynamically imported module: /assets/dist-DwgSDvZd.js",
	);

	it("reloads once onto the current build", () => {
		expect(recoverFromStaleChunk(staleChunkError)).toBe(true);
		expect(reload).toHaveBeenCalledTimes(1);
	});

	// Without this guard a client that genuinely cannot fetch the chunk would
	// reload forever instead of surfacing the error.
	it("does not reload a second time", () => {
		expect(recoverFromStaleChunk(staleChunkError)).toBe(true);
		expect(recoverFromStaleChunk(staleChunkError)).toBe(false);
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it("reloads again after a successful render clears the marker", () => {
		expect(recoverFromStaleChunk(staleChunkError)).toBe(true);
		clearStaleChunkMarker();
		expect(recoverFromStaleChunk(staleChunkError)).toBe(true);
		expect(reload).toHaveBeenCalledTimes(2);
	});

	it("leaves unrelated errors to be reported", () => {
		expect(recoverFromStaleChunk(new Error("NetworkError"))).toBe(false);
		expect(reload).not.toHaveBeenCalled();
	});
});
