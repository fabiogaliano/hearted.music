/**
 * The two capability signals that aren't the extension PING: can this browser
 * run our extension at all, and is this a device it's usable on. Onboarding
 * gates its wizard on them; screens that write through the extension use them
 * to tell "install it" from "use a computer". (Extension presence is polled
 * separately.)
 *
 * Both signals go through useSyncExternalStore: the server snapshots are
 * optimistic (capable, fits) so SSR and the hydration render agree, and React
 * re-syncs the real client snapshots before paint — consumers never flash the
 * wrong branch and don't need a "ready" flag. The form-factor signal is a live
 * subscription, so flipping a tablet to portrait mid-onboarding re-evaluates
 * the gate rather than stranding the user.
 */

import { useSyncExternalStore } from "react";
import {
	type EngineSupport,
	getEngineSupport,
} from "@/lib/extension/browser-target";

// We block the wizard only on a genuine handheld — small AND touch-primary with
// no hover. Raw width alone can't tell a phone from a desktop window dragged
// narrow, and a capable computer must never be told it "needs a computer" just
// for being resized. A desktop keeps a fine pointer + hover at any width, so it
// always clears this; a phone in portrait (the case the gate is actually for —
// Firefox Android is engine-capable but too cramped) still drops to the handoff.
const HANDHELD_QUERY =
	"(max-width: 767px) and (pointer: coarse) and (hover: none)";

let handheldMql: MediaQueryList | undefined;
function getHandheldMql(): MediaQueryList {
	handheldMql ??= window.matchMedia(HANDHELD_QUERY);
	return handheldMql;
}

function subscribeToFormFactor(onStoreChange: () => void): () => void {
	const mql = getHandheldMql();
	mql.addEventListener("change", onStoreChange);
	return () => mql.removeEventListener("change", onStoreChange);
}

function getFitsScreen(): boolean {
	return !getHandheldMql().matches;
}

// The engine never changes within a page lifetime, so the store never emits.
const subscribeToNothing = () => () => {};

const serverEngine = (): EngineSupport => "chromium";
const serverFitsScreen = () => true;

export type ExtensionCapability = {
	engine: EngineSupport;
	engineSupported: boolean;
	/** Not a too-small touch handheld. */
	fitsScreen: boolean;
	/** Both hard gates pass: a supported engine on a device that isn't a handheld. */
	canRunExtensionHere: boolean;
};

export function useExtensionCapability(): ExtensionCapability {
	const engine = useSyncExternalStore(
		subscribeToNothing,
		getEngineSupport,
		serverEngine,
	);
	const fitsScreen = useSyncExternalStore(
		subscribeToFormFactor,
		getFitsScreen,
		serverFitsScreen,
	);

	const engineSupported = engine !== "unsupported";

	return {
		engine,
		engineSupported,
		fitsScreen,
		canRunExtensionHere: engineSupported && fitsScreen,
	};
}
