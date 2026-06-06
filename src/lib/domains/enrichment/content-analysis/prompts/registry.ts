import { instrumentalV2 } from "./instrumental-v2";
import { instrumentalV3 } from "./instrumental-v3";
import { lyricalV2 } from "./lyrical-v2";
import { lyricalV3 } from "./lyrical-v3";
import { lyricalV4 } from "./lyrical-v4";
import { lyricalV5 } from "./lyrical-v5";
import { lyricalV6 } from "./lyrical-v6";
import { lyricalV7 } from "./lyrical-v7";
import { lyricalV8 } from "./lyrical-v8";
import { lyricalV9 } from "./lyrical-v9";
import { lyricalV10 } from "./lyrical-v10";
import { lyricalV11 } from "./lyrical-v11";
import { lyricalV12 } from "./lyrical-v12";
import { lyricalV13 } from "./lyrical-v13";
import { lyricalV14 } from "./lyrical-v14";
import { lyricalV15 } from "./lyrical-v15";
import { lyricalV16 } from "./lyrical-v16";
import { lyricalV17 } from "./lyrical-v17";
import type { PromptVersion } from "./types";

const LYRICAL_PROMPTS: Record<string, PromptVersion> = {
	"2": lyricalV2,
	"3": lyricalV3,
	"4": lyricalV4,
	"5": lyricalV5,
	"6": lyricalV6,
	"7": lyricalV7,
	"8": lyricalV8,
	"9": lyricalV9,
	"10": lyricalV10,
	"11": lyricalV11,
	"12": lyricalV12,
	"13": lyricalV13,
	"14": lyricalV14,
	"15": lyricalV15,
	"16": lyricalV16,
	"17": lyricalV17,
};

const INSTRUMENTAL_PROMPTS: Record<string, PromptVersion> = {
	"2": instrumentalV2,
	"3": instrumentalV3,
};

// The versions production ships today. Bump these to promote a new prompt; the
// stored analysis records the active version, so output is always traceable to its prompt.
//
// v14 is registered (so getLyricalPrompt("14") resolves) but deliberately NOT active:
// it emits the redesigned { read } model, while song-analysis.ts still parses against
// the old SongAnalysisLyricalSchema and the voice-audit jury is still old-schema. The
// generation-path + jury cutover to ConceptReadSchema is Session 5/6 work. See
// claudedocs/session-6-prod-panel-swap.md.
export const ACTIVE_LYRICAL_VERSION = "13";
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
