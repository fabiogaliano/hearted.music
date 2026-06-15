import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	aggregateClipFeatures,
	analyzeClip,
	analyzeClipsAll,
	type RawClipFeatures,
} from "../file-analysis";

const BASE: RawClipFeatures = {
	acousticness: 0.5,
	danceability: 0.5,
	energy: 0.5,
	instrumentalness: 0.1,
	liveness: 0.1,
	loudness: -8,
	speechiness: 0.05,
	tempo: 120,
	valence: 0.5,
};

function feat(overrides: Partial<RawClipFeatures>): RawClipFeatures {
	return { ...BASE, ...overrides };
}

function mockResponse(init: {
	status?: number;
	body?: unknown;
	statusText?: string;
	headers?: Record<string, string>;
}) {
	const { status = 200, body, statusText = "", headers = {} } = init;
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText,
		headers: {
			get: (k: string) => headers[k] ?? headers[k.toLowerCase()] ?? null,
		},
		json: async () => body,
	} as unknown as Response;
}

async function tmpClip(name: string): Promise<string> {
	const p = `${tmpdir()}/af-fa-${name}-${process.pid}-${Math.round(performance.now())}.mp3`;
	await writeFile(p, "fake-audio-bytes");
	return p;
}

const CONFIG = { tempoHalfDoubleTolerance: 0.08 };

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("aggregateClipFeatures", () => {
	it("duration-weights bounded features", () => {
		const { features } = aggregateClipFeatures(
			[
				{ features: feat({ energy: 0.6 }), durationSeconds: 30 },
				{ features: feat({ energy: 0.2 }), durationSeconds: 10 },
			],
			CONFIG,
		);
		// (0.6*30 + 0.2*10) / 40 = 0.5
		expect(features.energy).toBeCloseTo(0.5, 5);
	});

	it("averages loudness in linear power space, not raw dB", () => {
		const { features } = aggregateClipFeatures(
			[
				{ features: feat({ loudness: -6 }), durationSeconds: 30 },
				{ features: feat({ loudness: -12 }), durationSeconds: 30 },
			],
			CONFIG,
		);
		// linear mean of -6/-12 dB ≈ -8.04 dB, louder than the naive -9 dB mean.
		expect(features.loudness).toBeCloseTo(-8.04, 1);
		expect(features.loudness).toBeGreaterThan(-9);
	});

	it("normalizes half/double tempo to the dominant cluster", () => {
		const { features, metadata } = aggregateClipFeatures(
			[
				{ features: feat({ tempo: 150 }), durationSeconds: 30 },
				{ features: feat({ tempo: 75 }), durationSeconds: 30 },
				{ features: feat({ tempo: 150 }), durationSeconds: 30 },
			],
			CONFIG,
		);
		expect(features.tempo).toBeCloseTo(150, 5);
		expect(metadata.tempoConfidence).toBe("high");
	});

	it("flags low tempo confidence when clips disagree beyond tolerance", () => {
		const { metadata } = aggregateClipFeatures(
			[
				{ features: feat({ tempo: 120 }), durationSeconds: 30 },
				{ features: feat({ tempo: 180 }), durationSeconds: 30 },
			],
			CONFIG,
		);
		expect(metadata.tempoConfidence).toBe("low");
	});

	it("passes a single clip through with high confidence", () => {
		const { features, metadata } = aggregateClipFeatures(
			[{ features: feat({ energy: 0.77 }), durationSeconds: 18 }],
			CONFIG,
		);
		expect(features.energy).toBeCloseTo(0.77, 5);
		expect(metadata.tempoConfidence).toBe("high");
		expect(metadata.clipDurationsSeconds).toEqual([18]);
	});
});

describe("analyzeClip", () => {
	it("retries a 429 honoring Retry-After, then succeeds", async () => {
		const file = await tmpClip("429");
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				mockResponse({ status: 429, headers: { "Retry-After": "0" } }),
			)
			.mockResolvedValueOnce(mockResponse({ status: 200, body: BASE }));
		vi.stubGlobal("fetch", fetchMock);

		const result = await analyzeClip(file);

		expect(Result.isOk(result)).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("rejects a malformed (incomplete) response", async () => {
		const file = await tmpClip("malformed");
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					mockResponse({ status: 200, body: { energy: 0.5 } }),
				),
		);

		const result = await analyzeClip(file);

		expect(Result.isError(result)).toBe(true);
	});
});

describe("analyzeClipsAll", () => {
	it("fails the whole set if any clip cannot be analyzed", async () => {
		const f0 = await tmpClip("ok");
		const f1 = await tmpClip("bad");
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(mockResponse({ status: 200, body: BASE }))
				.mockResolvedValue(
					mockResponse({ status: 400, statusText: "bad file" }),
				),
		);

		const result = await analyzeClipsAll([
			{ path: f0, durationSeconds: 30 },
			{ path: f1, durationSeconds: 30 },
		]);
		expect(Result.isError(result)).toBe(true);
	});
});
