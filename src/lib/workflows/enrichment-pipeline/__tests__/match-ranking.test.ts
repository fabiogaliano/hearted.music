import { describe, expect, it } from "vitest";
import {
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
