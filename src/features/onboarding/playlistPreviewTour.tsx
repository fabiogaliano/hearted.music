import {
	createContext,
	type ReactNode,
	useContext,
	useMemo,
	useState,
} from "react";
import { useFlaggedPlaylistIds } from "./demoSandboxStore";

export type TourStep =
	| "concept"
	| "open"
	| "add"
	| "intent-intro"
	| "intent"
	| "done";

/** How the overlay treats the surround at a given step. */
type TourMode = "block" | "highlight" | "none";

interface TourReporter {
	/** The detail panel opened on `id`, or closed (`null`). */
	reportPanelOpen: (id: string | null) => void;
	/** An intent was saved for `id` — ends the first guided cycle and releases. */
	reportIntentSaved: (id: string) => void;
	/** The user tapped Next past the concept step. */
	advanceConcept: () => void;
	/** The user dismissed the "what's a matching intent?" coach-mark — reveals the
	 *  picker for the first intent. */
	explainIntent: () => void;
	/** The user tapped Help after the tour released — re-arm the spotlight + hints
	 *  for wherever they currently are, as on the first run. */
	requestHelp: () => void;
}

interface TourStepInfo {
	step: TourStep;
	targetSelector: string | null;
	mode: TourMode;
	/** Short instruction shown beside the spotlight; absent where the lit UI
	 *  (the Next button, the auto-opened editor) already says what to do. */
	caption?: string;
	/** Override the feather distance on the bottom edge (defaults to the same as
	 *  `feather`). A shorter value keeps a soft transition while covering content
	 *  that sits just below the window. */
	bottomFeather?: number;
	/** Override the feather distance on the top edge — shorter than the default
	 *  pulls the solid dim down toward the window so it covers a caption (and the
	 *  page copy behind it) that floats just above the lit window. */
	topFeather?: number;
	/** Whether a detail panel is currently open — lets the route hide cover-flow
	 *  chrome (e.g. the Help button) while the user is inside the panel. */
	panelOpen: boolean;
}

const REQUIRED_FLAGGED_COUNT = 2;

const NOOP_REPORTER: TourReporter = {
	reportPanelOpen: () => {},
	reportIntentSaved: () => {},
	advanceConcept: () => {},
	explainIntent: () => {},
	requestHelp: () => {},
};

const ReporterContext = createContext<TourReporter>(NOOP_REPORTER);
const StepContext = createContext<TourStepInfo>({
	step: "done",
	targetSelector: null,
	mode: "none",
	panelOpen: false,
});

const TARGET: Record<TourStep, Omit<TourStepInfo, "step" | "panelOpen">> = {
	// Blocking, but the Next button rendered inside the concept block is the
	// advance — so no tap-anywhere scrim and no caption (the paragraph + button
	// carry it). The window unions the page title with the concept block so the
	// "Playlists" masthead stays inside the lit rectangle, not dimmed above it.
	concept: {
		targetSelector: '[data-tour="page-title"], [data-tour="matching"]',
		mode: "block",
		bottomFeather: 16,
	},
	open: {
		targetSelector: '[data-tour="library"]',
		mode: "block",
		caption: "Pick a playlist to open it",
		// The caption floats in the dimmed gap above the Library window; a short top
		// feather pulls the solid dim down to it so the matching-empty copy behind the
		// pill reads as covered, not faintly legible.
		topFeather: 28,
	},
	// Lights the whole hero band (cover + title + toggle) so the playlist the user
	// just opened stays legible; the pulsing glow on the toggle is the instruction,
	// so no caption.
	add: { targetSelector: '[data-tour="add-target"]', mode: "block" },
	// A teaching beat before the first pick: no spotlight window — the route floats
	// a coach-mark over a full dim that explains what a matching intent is, then the
	// user dismisses it to reveal the picker (the "intent" step below).
	"intent-intro": { targetSelector: null, mode: "none" },
	// Highlight (visual only): the panel is locked at its own level, but the user
	// must be free to type, shuffle and Save inside the lit zone. Unions the hero
	// band with the editor so the cover + name the user just added stay lit above
	// the writing surface, not dimmed off.
	intent: {
		targetSelector: '[data-tour="add-target"], [data-tour="intent-zone"]',
		mode: "highlight",
	},
	done: { targetSelector: null, mode: "none" },
};

/**
 * Drives the flag-playlists walkthrough as a forced first cycle —
 * concept → open a playlist → add it → write its intent — then releases (the live
 * "Pick N to continue" countdown carries the remaining adds, and the panel is
 * freely closable again). The step is derived from observable demo state: whether
 * Next was tapped, which detail panel is open (reported by the sandbox screen),
 * whether that open playlist is in the flagged set (the shared store), and whether
 * any intent was saved. Deriving it here keeps the playlist components ignorant of
 * onboarding while the panel stays locked through the teaching moment.
 */
export function PlaylistPreviewTourProvider({
	children,
}: {
	children: ReactNode;
}) {
	const flaggedIds = useFlaggedPlaylistIds();
	const [panelOpenId, setPanelOpenId] = useState<string | null>(null);
	const [intentSaved, setIntentSaved] = useState(false);
	const [conceptAdvanced, setConceptAdvanced] = useState(false);
	const [intentExplained, setIntentExplained] = useState(false);
	// Set by the Help button after release; re-arms the derived tour for the user's
	// current spot. Cleared when they next save an intent, releasing it again.
	const [helpActive, setHelpActive] = useState(false);

	const reporter = useMemo<TourReporter>(
		() => ({
			reportPanelOpen: setPanelOpenId,
			reportIntentSaved: () => {
				setIntentSaved(true);
				setHelpActive(false);
			},
			advanceConcept: () => setConceptAdvanced(true),
			explainIntent: () => setIntentExplained(true),
			requestHelp: () => setHelpActive(true),
		}),
		[],
	);

	const stepInfo = useMemo<TourStepInfo>(() => {
		let step: TourStep;
		if (!conceptAdvanced) step = "concept";
		// Help re-opens the guided path: skip the "done" release and re-derive the
		// step from where the user actually is (panel open? this one flagged yet?).
		else if (intentSaved && !helpActive) step = "done";
		else if (panelOpenId === null) step = "open";
		else if (!flaggedIds.includes(panelOpenId)) step = "add";
		else if (!intentExplained) step = "intent-intro";
		else step = "intent";
		return { step, ...TARGET[step], panelOpen: panelOpenId !== null };
	}, [
		conceptAdvanced,
		intentSaved,
		helpActive,
		panelOpenId,
		flaggedIds,
		intentExplained,
	]);

	return (
		<ReporterContext.Provider value={reporter}>
			<StepContext.Provider value={stepInfo}>{children}</StepContext.Provider>
		</ReporterContext.Provider>
	);
}

export const usePlaylistTourReporter = () => useContext(ReporterContext);
export const usePlaylistTourStep = () => useContext(StepContext);

export { REQUIRED_FLAGGED_COUNT };
