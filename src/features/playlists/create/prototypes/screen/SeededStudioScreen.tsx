/**
 * Whole-screen direction 5 — SEEDED STUDIO, the hybrid of the two winners.
 * Beat 1 is Seeded Flow's landing (one question, presets, your own words);
 * beat 2 is the shared DraftStage (sticky config rail = cause, living draft
 * = effect, create anchored in the rail, playlist name as the page title,
 * pre-filled from the chosen preset). The seed carries through: preset
 * intent/genres (or your typed vibe) arrive in the rail already filled in.
 * Judge: do the three virtues survive each other — soft landing,
 * cause-beside-effect, object-first naming?
 */

import { useState } from "react";
import type { IntentGateVM, SeedTemplateVM } from "../types";
import { DraftStage, type Seed } from "./DraftStage";
import { SeedStage } from "./SeedStage";
import type { ProtoDraft } from "./useProtoDraft";

export function SeededStudioScreen({
	draft,
	templates,
	totalLikedCount,
	intentGate,
}: {
	draft: ProtoDraft;
	templates: SeedTemplateVM[];
	totalLikedCount: number;
	intentGate: IntentGateVM;
}) {
	const [seed, setSeed] = useState<Seed | null>(null);

	if (!seed) {
		return (
			<SeedStage
				templates={templates}
				totalLikedCount={totalLikedCount}
				intentGate={intentGate}
				onSeed={(preset, intentText) => setSeed({ preset, intentText })}
			/>
		);
	}
	return <DraftStage draft={draft} seed={seed} intentGate={intentGate} />;
}
