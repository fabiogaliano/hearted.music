import { usePostHog } from "@posthog/react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
	disableSentryReplay,
	enableSentryReplay,
} from "@/lib/observability/sentry";
import { persistConsentDecision } from "@/lib/server/consent.functions";
import { ConsentContext } from "./consent-context";
import type { ResolvedConsent } from "./consent-policy";
import {
	type ConsentStatus,
	clearConsent,
	readConsent,
	writeConsent,
} from "./consent-storage";

interface ConsentProviderProps {
	children: ReactNode;
	// Whether the current request is from a logged-in user. Decides which store
	// is authoritative: cookie (anonymous) vs DB (authenticated).
	isAuthenticated: boolean;
	// Server-resolved DB consent. null for anonymous users (cookie is their only
	// source); for authenticated users it is the authoritative starting point.
	initialConsent: ResolvedConsent | null;
}

export function ConsentProvider({
	children,
	isAuthenticated,
	initialConsent,
}: ConsentProviderProps) {
	const posthog = usePostHog();

	// Seed from server-resolved DB consent only when it is already valid: that
	// lets an authenticated user with durable consent render flash-free (banner
	// hidden on the first paint, server and client agree). Every other case
	// stays unresolved until the client effect reads the cookie.
	const trustedInitial =
		isAuthenticated && initialConsent?.state === "valid"
			? initialConsent.status
			: null;
	const [status, setStatus] = useState<ConsentStatus | null>(trustedInitial);
	const [resolved, setResolved] = useState(trustedInitial !== null);
	const [reopened, setReopened] = useState(false);
	const [isUpdating, setIsUpdating] = useState(false);

	const applyGranted = useCallback(() => {
		// Accept: opt in for full identified capture. With cookieless_mode the
		// SDK switches from anonymous hashing to its normal persistence on opt-in;
		// that explicit consent marker is configured at init to a versioned cookie
		// so it expires alongside our app-level consent.
		// Replay is consent-gated, so it's started here.
		posthog?.opt_in_capturing();
		// Load the replay recorder from our own bundle instead of letting
		// posthog-js lazy-fetch /static/posthog-recorder.js. Ad/privacy blockers
		// match that filename by substring (ERR_BLOCKED_BY_CLIENT) even through the
		// same-origin pulse-h tunnel, because the leaf name still reads as a known
		// tracker asset. Importing it executes the recorder IIFE, which registers
		// rrweb on window.__PosthogExtensions__; startSessionRecording then sees the
		// recorder already present and starts directly without any external fetch.
		// The dynamic import keeps it a separate chunk, so it stays lazy and
		// Accept-gated — decline/pending visitors never download rrweb. On the off
		// chance the chunk itself fails, fall back to posthog's own loader.
		void import("posthog-js/dist/posthog-recorder")
			.then(() => posthog?.startSessionRecording())
			.catch(() => posthog?.startSessionRecording());
		enableSentryReplay();
	}, [posthog]);

	const applyDenied = useCallback(() => {
		// Decline: opt out. Because PostHog runs cookieless_mode "on_reject",
		// opt-out does NOT go silent — it keeps counting the user anonymously
		// via a server-side daily-rotating hash, with no device storage. Replay
		// can't be anonymized, so it stays off.
		posthog?.opt_out_capturing();
		posthog?.stopSessionRecording();
		disableSentryReplay();
	}, [posthog]);

	const apply = useCallback(
		(decision: ConsentStatus) => {
			if (decision === "granted") applyGranted();
			else applyDenied();
		},
		[applyGranted, applyDenied],
	);

	const resetPostHogToPending = useCallback(() => {
		// When our app-level consent has expired or is missing, clear any stale
		// PostHog opt-in marker too. That returns the SDK to its true "pending"
		// state (no pre-choice capture) instead of silently reusing an older SDK-
		// persisted decision.
		posthog?.clear_opt_in_out_capturing();
		posthog?.stopSessionRecording();
		disableSentryReplay();
	}, [posthog]);

	const persistIfAuthenticated = useCallback(
		async (
			decision: ConsentStatus,
			source: "banner-action" | "cookie-backfill",
		): Promise<boolean> => {
			if (!isAuthenticated) return true;

			try {
				await persistConsentDecision({ data: { status: decision } });
				return true;
			} catch (error) {
				console.error("[consent] Failed to persist consent decision", {
					source,
					decision,
					error,
				});
				return false;
			}
		},
		[isAuthenticated],
	);

	// Reconcile the two stores once on the client, and re-apply SDK side effects
	// (which start neutral each session). Precedence: anonymous → cookie only;
	// authenticated → DB wins.
	useEffect(() => {
		const cookie = readConsent();

		if (!isAuthenticated) {
			setStatus(cookie);
			if (cookie) apply(cookie);
			else resetPostHogToPending();
			setResolved(true);
			return;
		}

		switch (initialConsent?.state) {
			case "valid": {
				// DB is authoritative. Keep the cookie in lockstep so a later
				// anonymous/offline read agrees with what the DB already knows.
				if (cookie !== initialConsent.status)
					writeConsent(initialConsent.status);
				setStatus(initialConsent.status);
				apply(initialConsent.status);
				break;
			}
			case "absent": {
				// Never decided in the DB. Backfill from a still-valid cookie exactly
				// once (the anonymous → signed-in migration path); otherwise ask.
				if (cookie) {
					setStatus(cookie);
					apply(cookie);
					void persistIfAuthenticated(cookie, "cookie-backfill");
				} else {
					resetPostHogToPending();
					setStatus(null);
				}
				break;
			}
			default: {
				// "stale": the authenticated user's durable DB decision lapsed or
				// predates the current policy version. Re-ask, and drop the stale
				// cookie so it can't keep applying a decision the DB no longer
				// honors.
				clearConsent();
				resetPostHogToPending();
				setStatus(null);
				break;
			}
		}

		setResolved(true);
	}, [
		isAuthenticated,
		initialConsent,
		apply,
		persistIfAuthenticated,
		resetPostHogToPending,
	]);

	const commitDecision = useCallback(
		async (decision: ConsentStatus): Promise<void> => {
			if (!isAuthenticated) {
				writeConsent(decision);
				setStatus(decision);
				setReopened(false);
				apply(decision);
				return;
			}

			setIsUpdating(true);
			const persisted = await persistIfAuthenticated(decision, "banner-action");
			setIsUpdating(false);
			if (!persisted) {
				toast.error(
					"We couldn't save your privacy choice. Your previous setting is still in effect.",
				);
				return;
			}

			writeConsent(decision);
			setStatus(decision);
			setReopened(false);
			apply(decision);
		},
		[apply, isAuthenticated, persistIfAuthenticated],
	);

	const grant = useCallback(() => {
		if (isUpdating) return;
		void commitDecision("granted");
	}, [commitDecision, isUpdating]);

	const deny = useCallback(() => {
		if (isUpdating) return;
		void commitDecision("denied");
	}, [commitDecision, isUpdating]);

	const reopen = useCallback(() => setReopened(true), []);

	const showBanner = (resolved && status === null) || reopened;

	return (
		<ConsentContext.Provider
			value={{ status, showBanner, isUpdating, grant, deny, reopen }}
		>
			{children}
		</ConsentContext.Provider>
	);
}
