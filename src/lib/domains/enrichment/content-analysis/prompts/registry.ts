import { instrumentalV3 } from "./instrumental-v3";
import { lyricalV17 } from "./lyrical-v17";
import type { PromptVersion } from "./types";

// Experiment-only versions live in scripts/voice-audit/prompts so they never
// ship in the app bundle.
const LYRICAL_PROMPTS: Record<string, PromptVersion> = {
	"17": lyricalV17,
};

const INSTRUMENTAL_PROMPTS: Record<string, PromptVersion> = {
	"3": instrumentalV3,
};

// The versions production ships today. Bump these to promote a new prompt; the
// stored analysis records the active version, so output is always traceable to its prompt.
//
// v17 is active: it emits the redesigned { read } model (SongReadSchema). Because the
// version is >= 14, song-analysis.ts parses generated output against SongReadSchema and
// stores the read flat (see buildAnalysisData), and the production song-detail surface now
// renders it through SongDetailPanel. NOTE: flipping ACTIVE is global — embeddings/matching for
// newly-generated rows go stale until the matching layer is rebuilt (a later task).
export const ACTIVE_LYRICAL_VERSION = "17";
export const ACTIVE_INSTRUMENTAL_VERSION = "3";

export function getLyricalPrompt(
	version: string = ACTIVE_LYRICAL_VERSION,
): PromptVersion {
	const prompt = LYRICAL_PROMPTS[version];
	if (!prompt) {
		throw new Error(
			`Unknown lyrical prompt version "${version}". Known: ${Object.keys(LYRICAL_PROMPTS).join(", ")}`,
		);
	}
	return prompt;
}

export function getInstrumentalPrompt(
	version: string = ACTIVE_INSTRUMENTAL_VERSION,
): PromptVersion {
	const prompt = INSTRUMENTAL_PROMPTS[version];
	if (!prompt) {
		throw new Error(
			`Unknown instrumental prompt version "${version}". Known: ${Object.keys(INSTRUMENTAL_PROMPTS).join(", ")}`,
		);
	}
	return prompt;
}
