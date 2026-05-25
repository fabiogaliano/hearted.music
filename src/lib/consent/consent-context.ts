import { createContext, useContext } from "react";
import type { ConsentStatus } from "./consent-storage";

// Pure context definition, deliberately free of any SDK/server imports so
// presentational consumers (ConsentBanner, its Ladle story) don't drag the
// PostHog/Sentry/@tanstack-start graph into a browser-only bundle. The
// side-effectful wiring lives in ConsentProvider.
export interface ConsentContextValue {
	// null means "no decision recorded yet" — distinct from an explicit denial.
	status: ConsentStatus | null;
	showBanner: boolean;
	isUpdating: boolean;
	grant: () => void;
	deny: () => void;
	// Lets a settings/footer control re-surface the banner so withdrawing
	// consent is exactly as easy as giving it (a GDPR requirement).
	reopen: () => void;
}

export const ConsentContext = createContext<ConsentContextValue | null>(null);

export function useConsent(): ConsentContextValue {
	const value = useContext(ConsentContext);
	if (value === null) {
		throw new Error("useConsent must be used within a ConsentProvider");
	}
	return value;
}
