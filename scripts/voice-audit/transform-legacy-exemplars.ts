/**
 * Scaffolds new-model exemplar drafts (exemplars-v14-draft/) from the legacy
 * gold (exemplars/). Separate dir on purpose: loadGoldExemplars() still parses
 * the live exemplars/ through the old schema (§8.5). Drafts feed Session 5.
 *
 * Run: bun scripts/voice-audit/transform-legacy-exemplars.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transformLegacyToConceptDraft } from "@/lib/domains/enrichment/content-analysis/concept-migration";
import { SongAnalysisLyricalSchema } from "@/lib/domains/enrichment/content-analysis/song-analysis";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "exemplars");
const OUT = join(HERE, "exemplars-v14-draft");

interface IndexEntry {
	key: string;
	song: string;
	spotifyTrackId: string;
	file: string;
}

const index = JSON.parse(readFileSync(join(SRC, "index.json"), "utf-8")) as {
	entries: IndexEntry[];
};

mkdirSync(OUT, { recursive: true });

for (const entry of index.entries) {
	const raw = JSON.parse(readFileSync(join(SRC, entry.file), "utf-8"));
	const legacy = SongAnalysisLyricalSchema.parse(raw);
	const draft = transformLegacyToConceptDraft(legacy);

	const annotated = {
		_draft: {
			source: entry.file,
			needs_hand_authoring: ["read.lens", "read.contradiction", "read.take"],
			note: "lens/contradiction have no legacy source; take is a mechanical concat scaffold. Author from concept-lens-vocabulary.md before promoting to gold.",
		},
		...draft,
	};

	writeFileSync(
		join(OUT, entry.file),
		`${JSON.stringify(annotated, null, 2)}\n`,
	);
	console.log(`drafted ${entry.file}  (arc ${draft.read.arc.length}, lines ${draft.read.lines.length})`);
}

console.log(`\n${index.entries.length} drafts written to ${OUT}`);
