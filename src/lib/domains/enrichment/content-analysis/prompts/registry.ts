import { instrumentalV3 } from "./instrumental-v3";
import { lyricalV17 } from "./lyrical-v17";
import { lyricalV17Regrouped } from "./lyrical-v17-regrouped";
import { lyricalV19 } from "./lyrical-v19";
import { lyricalV20 } from "./lyrical-v20";
import { lyricalV21 } from "./lyrical-v21";
import { lyricalV22 } from "./lyrical-v22";
import { lyricalV23 } from "./lyrical-v23";
import { lyricalV24 } from "./lyrical-v24";
import { lyricalV25 } from "./lyrical-v25";
import { lyricalV26 } from "./lyrical-v26";
import { lyricalV27 } from "./lyrical-v27";
import { lyricalV28 } from "./lyrical-v28";
import { lyricalV29 } from "./lyrical-v29";
import { lyricalV30 } from "./lyrical-v30";
import type { PromptVersion } from "./types";

const LYRICAL_PROMPTS: Record<string, PromptVersion> = {
	"17": lyricalV17,
	"18": lyricalV17Regrouped,
	"19": lyricalV19,
	"20": lyricalV20,
	"21": lyricalV21,
	"22": lyricalV22,
	"23": lyricalV23,
	"24": lyricalV24,
	"25": lyricalV25,
	"26": lyricalV26,
	"27": lyricalV27,
	"28": lyricalV28,
	"29": lyricalV29,
	"30": lyricalV30,
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

export function listLyricalVersions(): string[] {
	return Object.keys(LYRICAL_PROMPTS);
}
