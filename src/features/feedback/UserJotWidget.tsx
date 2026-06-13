import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { env } from "@/env";
import { userJotSignatureQueryOptions } from "./queries";
import {
	identifyUserJot,
	initUserJotWidget,
	showFeedbackWidget,
} from "./userjot-sdk";

// Build-time constant: Vite inlines VITE_* vars, so the widget is fully inert
// (no SDK load, no button, no query) when no project ID is configured.
const PROJECT_ID = env.VITE_USERJOT_PROJECT_ID;

interface UserJotWidgetProps {
	accountId: string;
	email: string;
}

/**
 * Loads UserJot in custom-trigger mode (its own launcher suppressed), identifies
 * the signed-in user, and renders our own circular launcher that opens the
 * feedback panel. Owning the button keeps it in the light DOM, so it themes with
 * plain Tailwind tokens instead of shadow-root style injection.
 */
export function UserJotWidget({ accountId, email }: UserJotWidgetProps) {
	const signatureQuery = useQuery({
		...userJotSignatureQueryOptions(accountId),
		enabled: Boolean(PROJECT_ID),
	});

	useEffect(() => {
		if (!PROJECT_ID) return;
		// Forced light: hearted has no global dark mode, so the panel surfaces
		// stay consistent even for users whose OS prefers dark.
		initUserJotWidget(PROJECT_ID, { position: "right", theme: "light" });
	}, []);

	// Identify only once the signature query settles — a string when secure mode
	// is configured, null when it isn't — so we never send an unsigned identity
	// that a secure-mode workspace would reject.
	useEffect(() => {
		if (!PROJECT_ID || !signatureQuery.isSuccess) return;
		identifyUserJot({
			id: accountId,
			email,
			signature: signatureQuery.data ?? undefined,
		});
	}, [accountId, email, signatureQuery.isSuccess, signatureQuery.data]);

	if (!PROJECT_ID) return null;

	return (
		<button
			type="button"
			onClick={() => showFeedbackWidget()}
			aria-label="Give feedback"
			className="fixed right-6 bottom-6 z-50 flex size-10 cursor-pointer items-center justify-center rounded-full bg-(--t-primary) text-(--t-text-on-primary) shadow-lg transition duration-150 ease-out hover:bg-(--t-primary-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:ring-offset-2 focus-visible:ring-offset-(--t-bg) motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-95 motion-reduce:transition-none"
		>
			<svg
				viewBox="0 0 18 18"
				className="size-4"
				fill="currentColor"
				aria-hidden="true"
				style={{ transform: "translateX(-1px)" }}
			>
				<path d="M9,1C4.589,1,1,4.589,1,9c0,1.396,.371,2.776,1.062,3.971,.238,.446-.095,2.002-.842,2.749-.209,.209-.276,.522-.17,.798,.106,.276,.365,.465,.66,.481,.079,.004,.16,.006,.241,.006,1.145,0,2.535-.407,3.44-.871,.675,.343,1.39,.587,2.131,.728,.484,.092,.982,.138,1.478,.138,4.411,0,8-3.589,8-8S13.411,1,9,1Z" />
			</svg>
		</button>
	);
}
