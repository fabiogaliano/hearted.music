/**
 * Playlist Creation — the chosen whole-screen candidate (NOT prod yet).
 *
 * This round explored several full recompositions of the creation experience
 * (config + draft + suggestions + create); Seeded Studio (hybrid) won and the
 * losing directions have been trimmed. It converges the round's winners:
 * Seeded Flow's seeded landing → Studio Split's draft stage, with Curation
 * Desk's name-as-page-title. Held constant while it was compared: the fixtures
 * (shared SONG_FIXTURES), the song-row anatomy (ProtoRow), and the live
 * add/remove loop (useProtoDraft, so songs really flow between the lists).
 *
 * Kept as the close-to-prod reference for the promotion — the composition is
 * settled; what remains is wiring the real query-backed config + result states
 * the fixtures stand in for. Best viewed at the desktop width preset.
 */

import type { Story } from "@ladle/react";
import { useMemo } from "react";
import {
	PROTO_INTENT_GATES,
	PROTO_TASTE_PROFILES,
} from "./prototypes/fixtures";
import { DraftStage } from "./prototypes/screen/DraftStage";
import { SeededStudioScreen } from "./prototypes/screen/SeededStudioScreen";
import { useProtoDraft } from "./prototypes/screen/useProtoDraft";
import { buildSeedTemplates } from "./prototypes/seedPresets";

export default { title: "Playlist Creation" };

interface SeededStudioArgs {
	library: "rich" | "sparse" | "brand-new";
	intentAccess: "unlocked" | "locked";
}

export const ScreenSeededStudio: Story<SeededStudioArgs> = ({
	library,
	intentAccess,
}) => {
	const draft = useProtoDraft();
	const profile = PROTO_TASTE_PROFILES[library];
	// Memoized per library: buildSeedTemplates randomizes the genre blank's
	// default, and a re-shuffle on every render would make the cards twitch.
	const templates = useMemo(() => buildSeedTemplates(profile), [profile]);
	return (
		// Keyed to the controls so flipping them remounts the flow back at the
		// seed stage — the stage/seed state would otherwise survive the change.
		<SeededStudioScreen
			key={`${library}-${intentAccess}`}
			draft={draft}
			templates={templates}
			totalLikedCount={profile.totalLikedCount}
			intentGate={PROTO_INTENT_GATES[intentAccess]}
		/>
	);
};
ScreenSeededStudio.storyName = "Prototype — Screen: Seeded Studio (hybrid)";
ScreenSeededStudio.args = {
	library: "rich",
	intentAccess: "unlocked",
};
ScreenSeededStudio.argTypes = {
	library: {
		options: ["rich", "sparse", "brand-new"],
		control: { type: "select" },
	},
	intentAccess: {
		options: ["unlocked", "locked"],
		control: { type: "radio" },
	},
};
ScreenSeededStudio.meta = {
	description:
		"The chosen candidate: a seeded landing flows into the studio draft stage, with the playlist name as the page title. Starting points are interactive mad-lib TEMPLATES derived from the taste profile — a dashed blank ('All things [indie]', 'Throwbacks: [2010s]', 'Where [indie] meets [electronic]') opens a popover listing its profile-ranked options, the arrow starts from the tuned result; 'from scratch' is a card naming the whole library and its count. Flip the library control (rich / sparse / brand-new) to see the spread adapt; flip intentAccess to see the own-words premium gate (Backstage Pass · or 1,000 songs from packs — 500 / 1,000).",
};

interface StudioDecisionArgs {
	previewState: "populated" | "empty" | "warming" | "not-enough";
	result: "editing" | "success" | "partial" | "unsynced";
}

export const ScreenStudioDecisions: Story<StudioDecisionArgs> = ({
	previewState,
	result,
}) => {
	const draft = useProtoDraft();
	return (
		// Mounts the studio (DraftStage) directly, skipping the seed landing, so the
		// remaining open decisions can be flipped in place. Keyed to the controls so
		// the live draft resets cleanly on each change.
		<DraftStage
			key={`${previewState}-${result}`}
			draft={draft}
			seed={{ preset: null, intentText: "" }}
			intentGate={PROTO_INTENT_GATES.unlocked}
			previewState={previewState}
			result={result}
		/>
	);
};
ScreenStudioDecisions.storyName = "Prototype — Studio: Open Decisions";
ScreenStudioDecisions.args = {
	previewState: "populated",
	result: "editing",
};
ScreenStudioDecisions.argTypes = {
	previewState: {
		options: ["populated", "empty", "warming", "not-enough"],
		control: { type: "select" },
	},
	result: {
		options: ["editing", "success", "partial", "unsynced"],
		control: { type: "select" },
	},
};
ScreenStudioDecisions.meta = {
	description:
		"The remaining open decisions from the promotion, each a control, inside the actual studio rail. (Filters is settled: prod's restyled MatchFiltersFieldList sits inline in the rail — popover was too hidden, and the rail-tuned rebuild was dropped once prod itself moved to the quiet rail register.) `previewState` swaps in the real LibraryEmptyState / NotEnoughSongsNote so the studio's first-cut hero is judged empty and warming, not just populated. `result` renders the real SuccessState / PartialState / UnsyncedState where Create lives, to decide whether a returned result fits the rail or needs a footer. Click through all four themes.",
};
