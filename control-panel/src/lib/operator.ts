const STORAGE_KEY = "hearted-control-panel.operator-label.v1";

// A local, non-sensitive label the single operator uses to fill "requested-by"
// audit fields (e.g. "ops@hearted"). It is a convenience default the operator
// can override per action, not an identity or auth boundary.
export function readOperatorLabel(): string {
	if (typeof window === "undefined") return "";
	try {
		return window.localStorage.getItem(STORAGE_KEY) ?? "";
	} catch {
		return "";
	}
}

export function writeOperatorLabel(label: string): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(STORAGE_KEY, label);
	} catch {
		// Best-effort; a blocked localStorage just means no default next time.
	}
}
