import type { ConnectionVerdict } from "./verdict";

/**
 * Whether a screen that writes to Spotify through the extension can offer the
 * write here. Only a missing extension changes it: every other verdict already
 * has its own reconnect or mismatch UI, and "checking" stays ready so the
 * action doesn't flash away while the first poll is in flight. A browser that
 * can never run the extension (iOS, Android Chrome, a handheld) is sent to a
 * computer; a capable one is sent to the store.
 */
export type ExtensionWriteGate = "ready" | "needs-computer" | "needs-extension";

export function deriveExtensionWriteGate(
	verdict: ConnectionVerdict,
	canRunExtensionHere: boolean,
): ExtensionWriteGate {
	if (verdict.kind !== "extension-missing") return "ready";
	return canRunExtensionHere ? "needs-extension" : "needs-computer";
}
