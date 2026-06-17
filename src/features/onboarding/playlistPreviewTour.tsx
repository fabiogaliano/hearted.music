import {
	createContext,
	type ReactNode,
	useContext,
	useMemo,
	useState,
} from "react";
import {
	useDemoPlaylistMetadata,
	useFlaggedPlaylistIds,
} from "./demoSandboxStore";

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
	/** The user tapped Next past the concept step. */
	advanceConcept: () => void;
	/** The user dismissed the "what's a matching intent?" coach-mark — reveals the
	 *  picker for the first intent. */
	explainIntent: () => void;
}

interface TourStepInfo {
	step: TourStep;
	targetSelector: string | null;
	mode: TourMode;
	/** Short instruction shown beside the spotlight; absent where the lit UI
	 *  (the Next button, the auto-opened editor) already says what to do. */
	caption?: string;
	/** Gap between the target and the cutout window (px). Defaults to the overlay's
	 *  own default where omitted. Set to 0 for full-bleed band targets (the hero), whose
	 *  own edge is the frame — any positive padding overshoots the band's bottom and
	 *  exposes the tonal step to the plain body beneath it. */
	padding?: number;
	/** Edge feather — how far the dim fades from solid to clear at the window edge (px).
	 *  Defaults to the overlay's own default where omitted. Set to 0 for band targets so
	 *  the dim meets the band's colour boundary as a crisp line; the default soft halo
	 *  straddles the edge and reads as the lit zone falling short of the band. */
	feather?: number;
	/** The playlist the rehearsal should have open: a flagged playlist still missing
	 *  its intent, which must be described before anything else (so a refresh that
	 *  reopened mid-cycle lands on finishing it rather than adding more). The sandbox
	 *  screen opens this panel; null when nothing is awaiting an intent. */
	focusPlaylistId: string | null;
}

const NOOP_REPORTER: TourReporter = {
	reportPanelOpen: () => {},
	advanceConcept: () => {},
	explainIntent: () => {},
};

const ReporterContext = createContext<TourReporter>(NOOP_REPORTER);
const StepContext = createContext<TourStepInfo>({
	step: "done",
	targetSelector: null,
	mode: "none",
	focusPlaylistId: null,
});

const TARGET: Record<
	TourStep,
	Omit<TourStepInfo, "step" | "focusPlaylistId">
> = {
	// Blocking, but the Next button rendered inside the concept block is the
	// advance — so no tap-anywhere scrim and no caption (the paragraph + button
	// carry it). The window unions the page title with the concept block so the
	// "Playlists" masthead stays inside the lit rectangle, not dimmed above it.
	concept: {
		targetSelector: '[data-tour="page-title"], [data-tour="matching"]',
		mode: "block",
	},
	open: {
		targetSelector: '[data-tour="library"]',
		mode: "block",
		caption: "Pick a playlist to open it",
	},
	// Focuses the playlist header's action cluster (title + add/remove pill), not the
	// whole band, so the onboarding cue lands on the control the user needs next.
	// The pulsing glow on the toggle is the instruction, so no caption.
	add: {
		targetSelector: '[data-tour="add-target"]',
		mode: "block",
	},
	// A teaching beat before the first pick: no spotlight window — the route floats
	// a coach-mark over a full dim that explains what a matching intent is, then the
	// user dismisses it to reveal the picker (the "intent" step below).
	"intent-intro": { targetSelector: null, mode: "none" },
	// Highlight (visual only): the panel is locked at its own level, but the user
	// must be free to type, shuffle and Save inside the lit zone. Unions the full
	// hero band with the editor so the cover + name stay lit above the writing
	// surface, not dimmed off.
	intent: {
		targetSelector: '[data-tour="intent-hero"], [data-tour="intent-zone"]',
		mode: "highlight",
		padding: 0,
		feather: 0,
	},
	done: { targetSelector: null, mode: "none" },
};

/**
 * Drives the flag-playlists walkthrough as a single guided cycle —
 * concept → open a playlist → add it → write its intent — then releases to "done",
 * which is what enables Continue (the panel is freely closable again). The step is
 * derived from observable demo state: whether Next was tapped, which detail panel is
 * open (reported by the sandbox screen), whether that open playlist is in the flagged
 * set (the shared store), and whether any intent was saved. Deriving it here keeps the
 * playlist components ignorant of onboarding while the panel stays locked through the
 * teaching moment.
 */
export function PlaylistPreviewTourProvider({
	children,
}: {
	children: ReactNode;
}) {
	const flaggedIds = useFlaggedPlaylistIds();
	const metadata = useDemoPlaylistMetadata();
	const [panelOpenId, setPanelOpenId] = useState<string | null>(null);
	const [conceptAdvanced, setConceptAdvanced] = useState(false);
	const [intentExplained, setIntentExplained] = useState(false);

	const reporter = useMemo<TourReporter>(
		() => ({
			reportPanelOpen: setPanelOpenId,
			advanceConcept: () => setConceptAdvanced(true),
			explainIntent: () => setIntentExplained(true),
		}),
		[],
	);

	// The flagged playlist still missing an intent (the first such in flag order),
	// and whether any flagged playlist has been described. Both derive from persisted
	// state (flagged set + intents), so a refresh resumes from the truth rather than a
	// guess. A pending playlist is the rehearsal's whole focus: it must be described
	// before more are added or the cycle releases — so it outranks both "add more" and
	// the self-driven release below.
	const { pendingIntentId, hasSavedIntent } = useMemo(() => {
		let pending: string | null = null;
		let saved = false;
		for (const id of flaggedIds) {
			const intent = metadata[id]?.intent;
			if (intent != null && intent.trim() !== "") saved = true;
			else if (pending === null) pending = id;
		}
		return { pendingIntentId: pending, hasSavedIntent: saved };
	}, [flaggedIds, metadata]);

	const stepInfo = useMemo<TourStepInfo>(() => {
		let step: TourStep;
		// Concept is taught once. Any deeper walkthrough state means we've already
		// passed it: a restored flagged playlist, or simply an open detail panel (for
		// example when the user removes the still-pending playlist and must be guided
		// to add it back, not bounced all the way to the broad empty-shelf concept
		// spotlight). Don't re-block on a step whose affordance no longer matches the
		// user's current context.
		const conceptDone =
			conceptAdvanced || flaggedIds.length > 0 || panelOpenId !== null;
		// Released = the self-driven state: at least one playlist described and none
		// left pending. A pending playlist keeps the cycle held, so a mid-cycle refresh
		// (added one, intent not yet written) resumes on finishing it.
		const released = hasSavedIntent && pendingIntentId === null;
		if (!conceptDone) step = "concept";
		else if (released) step = "done";
		// A not-yet-flagged playlist is open — the user is mid-add. (Can't collide with
		// a pending one: while something's pending its panel is locked open, so no
		// other playlist can be opened.)
		else if (panelOpenId !== null && !flaggedIds.includes(panelOpenId))
			step = "add";
		// Anything flagged but undescribed must get its intent before moving on.
		else if (pendingIntentId !== null)
			step = intentExplained ? "intent" : "intent-intro";
		else step = "open";

		// Drive the screen to open the pending playlist so the intent step has its
		// panel up — covers a refresh that reopened with the panel closed.
		const focusPlaylistId =
			step === "intent" || step === "intent-intro" ? pendingIntentId : null;
		return {
			step,
			...TARGET[step],
			focusPlaylistId,
		};
	}, [
		conceptAdvanced,
		panelOpenId,
		flaggedIds,
		intentExplained,
		hasSavedIntent,
		pendingIntentId,
	]);

	return (
		<ReporterContext.Provider value={reporter}>
			<StepContext.Provider value={stepInfo}>{children}</StepContext.Provider>
		</ReporterContext.Provider>
	);
}

export const usePlaylistTourReporter = () => useContext(ReporterContext);
export const usePlaylistTourStep = () => useContext(StepContext);
