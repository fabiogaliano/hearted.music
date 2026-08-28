import { StartClient } from "@tanstack/react-start/client";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { captureRecoverableError } from "@/lib/observability/sentry";

// Mirrors TanStack Start's default client entry, plus onRecoverableError.
// Hydration mismatches (React #418/#422) are recoverable: React drops the
// server tree and re-renders client-side without throwing, so nothing reaches
// a route error boundary and the default handler only reportError()s the bare
// message. Weeks of #418s arrived that way with no clue which component
// diverged. Keep the reportError so PostHog's global capture still sees them,
// and hand Sentry the component stack.
startTransition(() => {
	hydrateRoot(
		document,
		<StrictMode>
			<StartClient />
		</StrictMode>,
		{
			onRecoverableError(error, errorInfo) {
				captureRecoverableError(error, errorInfo.componentStack);
				reportError(error);
			},
		},
	);
});
