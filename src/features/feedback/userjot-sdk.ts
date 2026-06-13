/**
 * UserJot browser SDK loader for the floating feedback widget.
 *
 * The SDK is browser-only and stateful, so the loader + init run exactly once
 * per page load (guarded by a module flag that also survives StrictMode's
 * double-invoke). identify() is idempotent on UserJot's side and may run again
 * when the signed identity becomes available. Everything no-ops during SSR.
 */

interface UserJotIdentity {
	id: string;
	email?: string;
	firstName?: string;
	lastName?: string;
	avatar?: string;
	signature?: string;
}

interface UserJotInitOptions {
	widget?: boolean;
	position?: "left" | "right";
	theme?: "auto" | "light" | "dark";
	trigger?: "default" | "custom";
	locale?: string;
	onReady?: () => void;
	onError?: (error: Error) => void;
}

interface UserJotSdk {
	init: (projectId: string, options?: UserJotInitOptions) => void;
	identify: (identity: UserJotIdentity | null) => void;
	showWidget: (options?: {
		section?: "feedback" | "roadmap" | "updates";
	}) => void;
}

declare global {
	interface Window {
		uj?: UserJotSdk;
		$ujq?: unknown[];
	}
}

const SDK_SRC = "https://cdn.userjot.com/sdk/v2/uj.js";

let initialized = false;

export function initUserJotWidget(
	projectId: string,
	options?: Omit<UserJotInitOptions, "widget">,
): void {
	if (typeof window === "undefined" || initialized) return;
	initialized = true;

	if (!window.uj) {
		// UserJot's loader snippet: a queue plus a Proxy that buffers every call
		// until uj.js loads, replaces window.uj with the real SDK, and drains the
		// queue in order. Replicated here so calls before load aren't lost.
		window.$ujq = window.$ujq ?? [];
		window.uj = new Proxy({} as UserJotSdk, {
			get:
				(_, prop) =>
				(...args: unknown[]) =>
					window.$ujq?.push([prop, ...args]),
		});
		const script = document.createElement("script");
		script.src = SDK_SRC;
		script.type = "module";
		script.async = true;
		document.head.appendChild(script);
	}

	// trigger: "custom" suppresses UserJot's default pill launcher — we render
	// our own circular button and open the panel via showFeedbackWidget().
	window.uj.init(projectId, { widget: true, trigger: "custom", ...options });
}

export function identifyUserJot(identity: UserJotIdentity | null): void {
	if (typeof window === "undefined") return;
	window.uj?.identify(identity);
}

export function showFeedbackWidget(): void {
	if (typeof window === "undefined") return;
	window.uj?.showWidget({ section: "feedback" });
}
