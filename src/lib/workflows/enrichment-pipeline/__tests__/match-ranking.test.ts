import { describe, expect, it } from "vitest";
import {
	ANALYSIS_TAIL_MAX_CHARS,
	buildPlaylistRerankDocument,
	buildSongRerankDocument,
	MATCH_RANKING_ORIENTATIONS,
	MATCH_RANKING_SCHEMA_VERSION,
	RERANK_INSTRUCTION_BY_ORIENTATION,
} from "@/lib/workflows/enrichment-pipeline/match-ranking";

describe("match-ranking contracts", () => {
	it("MATCH_RANKING_ORIENTATIONS covers song and playlist", () => {
		expect(MATCH_RANKING_ORIENTATIONS).toContain("song");
		expect(MATCH_RANKING_ORIENTATIONS).toContain("playlist");
	});

	it("RERANK_INSTRUCTION_BY_ORIENTATION has an entry for every orientation", () => {
		for (const orientation of MATCH_RANKING_ORIENTATIONS) {
			const instruction = RERANK_INSTRUCTION_BY_ORIENTATION[orientation];
			expect(typeof instruction).toBe("string");
			expect(instruction.length).toBeGreaterThan(0);
		}
	});

	it("MATCH_RANKING_SCHEMA_VERSION is a non-empty string", () => {
		expect(typeof MATCH_RANKING_SCHEMA_VERSION).toBe("string");
		expect(MATCH_RANKING_SCHEMA_VERSION.length).toBeGreaterThan(0);
	});
});

describe("buildSongRerankDocument", () => {
	const baseSong = {
		name: "Alpha Song",
		artists: ["Artist A"],
		genres: ["pop"],
	};

	it("returns metadata mode when no analysisText is provided", () => {
		const { document, documentMode } = buildSongRerankDocument(baseSong);
		expect(documentMode).toBe("metadata");
		expect(document).toBe("Alpha Song by Artist A. Genres: pop.");
		expect(document).not.toContain("\n\n");
	});

	it("returns metadata mode when analysisText is null", () => {
		const { documentMode } = buildSongRerankDocument({
			...baseSong,
			analysisText: null,
		});
		expect(documentMode).toBe("metadata");
	});

	it("returns analysis mode when analysisText is provided", () => {
		const { document, documentMode } = buildSongRerankDocument({
			...baseSong,
			analysisText: "Dreamy pop with layered synths",
		});
		expect(documentMode).toBe("analysis");
		expect(document).toBe(
			"Alpha Song by Artist A. Genres: pop.\n\nDreamy pop with layered synths",
		);
	});

	it("handles multiple artists joined by comma", () => {
		const { document } = buildSongRerankDocument({
			...baseSong,
			artists: ["Artist A", "Artist B"],
		});
		expect(document).toContain("Artist A, Artist B");
	});

	it("handles null genres gracefully", () => {
		const { document } = buildSongRerankDocument({
			...baseSong,
			genres: null,
		});
		expect(document).toBe("Alpha Song by Artist A. Genres: .");
	});

	it("truncates analysis tail at a word boundary when it exceeds the char cap", () => {
		const wordCount = Math.ceil(ANALYSIS_TAIL_MAX_CHARS / 5) + 50;
		const longAnalysis = Array.from(
			{ length: wordCount },
			(_, i) => `word${i}`,
		).join(" ");
		expect(longAnalysis.length).toBeGreaterThan(ANALYSIS_TAIL_MAX_CHARS);

		const { document, documentMode } = buildSongRerankDocument({
			...baseSong,
			analysisText: longAnalysis,
		});

		expect(documentMode).toBe("analysis");
		const [prefix, tail] = document.split("\n\n");
		expect(prefix).toBe("Alpha Song by Artist A. Genres: pop.");
		expect(tail.length).toBeLessThanOrEqual(ANALYSIS_TAIL_MAX_CHARS);

		// Tail must end on a whole word token
		const tailWords = tail.split(" ");
		const lastWord = tailWords[tailWords.length - 1];
		expect(longAnalysis.split(" ")).toContain(lastWord);
	});

	it("produces the same metadata format as the inline builder in reranking.ts", () => {
		// Regression guard: the format must stay byte-identical to the existing
		// inline construction so switching callers to this builder is lossless.
		const { document } = buildSongRerankDocument({
			name: "Beta Song",
			artists: ["Artist B"],
			genres: ["rock"],
		});
		expect(document).toBe("Beta Song by Artist B. Genres: rock.");
	});
});

describe("buildPlaylistRerankDocument", () => {
	it("returns metadata mode always", () => {
		const { documentMode } = buildPlaylistRerankDocument({ name: "Chill" });
		expect(documentMode).toBe("metadata");
	});

	it("returns just the name when matchIntent and genrePills are absent", () => {
		const { document } = buildPlaylistRerankDocument({ name: "Chill" });
		expect(document).toBe("Chill");
	});

	it("appends matchIntent after name with em-dash separator", () => {
		const { document } = buildPlaylistRerankDocument({
			name: "Chill Vibes",
			matchIntent: "relaxing music",
		});
		expect(document).toBe("Chill Vibes — relaxing music");
	});

	it("appends genre pills as Genres suffix", () => {
		const { document } = buildPlaylistRerankDocument({
			name: "Chill Vibes",
			genrePills: ["indie", "lo-fi"],
		});
		expect(document).toBe("Chill Vibes. Genres: indie, lo-fi");
	});

	it("combines matchIntent and genrePills", () => {
		const { document } = buildPlaylistRerankDocument({
			name: "Chill Vibes",
			matchIntent: "relaxing music",
			genrePills: ["indie"],
		});
		expect(document).toBe("Chill Vibes — relaxing music. Genres: indie");
	});

	it("omits genre suffix when genrePills is null", () => {
		const { document } = buildPlaylistRerankDocument({
			name: "Chill",
			genrePills: null,
		});
		expect(document).toBe("Chill");
	});

	it("filters out empty strings from genrePills", () => {
		const { document } = buildPlaylistRerankDocument({
			name: "Chill",
			genrePills: ["", "pop", ""],
		});
		expect(document).toBe("Chill. Genres: pop");
	});
});
