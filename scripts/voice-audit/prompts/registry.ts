import {
	ACTIVE_LYRICAL_VERSION,
	getLyricalPrompt,
} from "@/lib/domains/enrichment/content-analysis/prompts/registry";
import type { PromptVersion } from "@/lib/domains/enrichment/content-analysis/prompts/types";
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

// The active production prompt is included so experiments can always be run
// against the baseline they are compared to.
const EXPERIMENT_LYRICAL_PROMPTS: Record<string, PromptVersion> = {
	[ACTIVE_LYRICAL_VERSION]: getLyricalPrompt(),
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

export function getExperimentLyricalPrompt(version: string): PromptVersion {
	const prompt = EXPERIMENT_LYRICAL_PROMPTS[version];
	if (!prompt) {
		throw new Error(
			`Unknown lyrical prompt version "${version}". Known: ${Object.keys(EXPERIMENT_LYRICAL_PROMPTS).join(", ")}`,
		);
	}
	return prompt;
}
