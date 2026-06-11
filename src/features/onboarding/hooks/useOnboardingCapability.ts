/**
 * The two onboarding gate signals that aren't the extension PING: can this
 * browser run our extension at all, and is the viewport big enough for the
 * wizard. (Extension presence is polled separately in InstallExtensionStep.)
 *
 * Both signals go through useSyncExternalStore: the server snapshots are
 * optimistic (capable, big screen) so SSR and the hydration render agree, and
 * React re-syncs the real client snapshots before paint — consumers never flash
 * the wrong branch and don't need a "ready" flag. The viewport is a live
 * subscription, so flipping a tablet to portrait mid-onboarding re-evaluates
 * the gate rather than stranding the user.
 */

import { useSyncExternalStore } from "react";
import {
	type EngineSupport,
	getEngineSupport,
} from "@/lib/extension/browser-target";

// Below this, the wizard (color picker, playlist flagging, walkthroughs) is too
// cramped. Landscape reports the wider edge, so a capable tablet held landscape
// clears it while a phone in portrait drops to the handoff.
const WIZARD_VIEWPORT_QUERY = "(min-width: 768px)";

let wizardMql: MediaQueryList | undefined;
function getWizardMql(): MediaQueryList {
	wizardMql ??= window.matchMedia(WIZARD_VIEWPORT_QUERY);
	return wizardMql;
}

function subscribeToViewport(onStoreChange: () => void): () => void {
	const mql = getWizardMql();
	mql.addEventListener("change", onStoreChange);
	return () => mql.removeEventListener("change", onStoreChange);
}

function getBigScreen(): boolean {
	return getWizardMql().matches;
}

// The engine never changes within a page lifetime, so the store never emits.
const subscribeToNothing = () => () => {};

const serverEngine = (): EngineSupport => "chromium";
const serverBigScreen = () => true;

export type OnboardingCapability = {
	engine: EngineSupport;
	engineSupported: boolean;
	bigScreen: boolean;
	/** Both hard gates pass: a supported engine on a wizard-sized screen. */
	canOnboardHere: boolean;
};

export function useOnboardingCapability(): OnboardingCapability {
	const engine = useSyncExternalStore(
		subscribeToNothing,
		getEngineSupport,
		serverEngine,
	);
	const bigScreen = useSyncExternalStore(
		subscribeToViewport,
		getBigScreen,
		serverBigScreen,
	);

	const engineSupported = engine !== "unsupported";

	return {
		engine,
		engineSupported,
		bigScreen,
		canOnboardHere: engineSupported && bigScreen,
	};
}
