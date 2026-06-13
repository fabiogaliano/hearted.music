/**
 * /_authenticated - Layout for authenticated routes.
 *
 * Provides: auth protection, onboarding redirect, sidebar layout.
 * Children access via Route.useRouteContext():
 *   - session: { accountId }
 *   - account: { display_name, email, ... }
 *   - theme: ThemeColor
 *
 * Performance: Auth + onboarding data are cached in TanStack Query.
 * On first entry (cause === "enter"), we fetch and cache both.
 * On subsequent navigations (cause === "stay"), we read from the
 * query cache synchronously — zero server round-trips.
 * Cache invalidates on logout (full page reload) or via
 * queryClient.invalidateQueries().
 */

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { Toaster } from "sonner";
import { ConsentBanner } from "@/components/consent/ConsentBanner";
import { UnverifiedEmailBanner } from "@/features/auth/UnverifiedEmailBanner";
import { UpgradeDialog } from "@/features/billing/components/UpgradeDialog";
import { WaitlistWelcomeDialog } from "@/features/billing/components/WaitlistWelcomeDialog";
import { usePostPurchaseReturn } from "@/features/billing/hooks/usePostPurchaseReturn";
import { billingKeys } from "@/features/billing/query-keys";
import { matchingSessionQueryOptions } from "@/features/matching/queries";
import {
	isPathAllowed,
	resolveSession,
} from "@/features/onboarding/step-resolver";
import { ConsentProvider } from "@/lib/consent/ConsentProvider";
import { getDisplayBalance, getPlanLabel } from "@/lib/domains/billing/display";
import type { BillingState } from "@/lib/domains/billing/state";
import { hasUnlimitedAccess } from "@/lib/domains/billing/state";
import { sessionMode } from "@/lib/domains/library/accounts/onboarding-session";
import { useActiveJobCompletionEffects } from "@/lib/hooks/useActiveJobs";
import { useAnalytics } from "@/lib/observability/useAnalytics";
import { sendVerificationEmail } from "@/lib/platform/auth/auth-client";
import {
	AUTH_SESSION_QUERY_KEY,
	ONBOARDING_SESSION_QUERY_KEY,
} from "@/lib/platform/auth/query-keys";
import { requireAuthSession } from "@/lib/server/auth.functions";
import { getBillingState } from "@/lib/server/billing.functions";
import { getInitialConsentState } from "@/lib/server/consent.functions";
import { getOnboardingSession } from "@/lib/server/onboarding.functions";
import { getWaitlistWelcome } from "@/lib/server/waitlist-welcome.functions";
import { AuthenticatedThemeProvider } from "@/lib/theme/authenticated-theme";
import { DEFAULT_THEME } from "@/lib/theme/types";
import { Sidebar } from "./-components/Sidebar";

const shouldLoadDevWorkflowPanel =
	import.meta.env.DEV && import.meta.env.MODE !== "test";

const DevWorkflowPanel = shouldLoadDevWorkflowPanel
	? lazy(() =>
			import("@/features/devtools/workflow-panel/DevWorkflowPanel").then(
				(m) => ({ default: m.DevWorkflowPanel }),
			),
		)
	: null;

export const Route = createFileRoute("/_authenticated")({
	beforeLoad: async ({ location, context }) => {
		const { queryClient } = context;

		const { session, account, identity } = await queryClient.ensureQueryData({
			queryKey: AUTH_SESSION_QUERY_KEY,
			queryFn: () => requireAuthSession(),
			staleTime: 5 * 60 * 1000,
		});

		// Guard-critical onboarding payload — small object, always fresh. Child
		// routes read `onboardingSession` and `theme` from context; they do
		// NOT need the full page payload (playlists, landing songs, etc.),
		// which lives in `/onboarding`'s own loader. We start billing in
		// parallel, but onboarding still resolves first so redirects are not
		// blocked by billing latency or failures.
		const onboardingSessionPromise = queryClient.ensureQueryData({
			queryKey: ONBOARDING_SESSION_QUERY_KEY,
			queryFn: () => getOnboardingSession(),
			staleTime: 0,
		});
		const billingStatePromise = queryClient
			.ensureQueryData({
				queryKey: billingKeys.state,
				queryFn: () => getBillingState(),
				staleTime: 5 * 60 * 1000,
			})
			.then((value) => ({ ok: true as const, value }))
			.catch((error: unknown) => ({ ok: false as const, error }));

		const { session: onboardingSession, theme } =
			await onboardingSessionPromise;

		if (onboardingSession.status !== "complete") {
			const resolved = resolveSession(onboardingSession);
			if (!isPathAllowed(location.pathname, resolved.allowedPath)) {
				if (resolved.allowedPath === "/onboarding") {
					throw redirect({
						to: "/onboarding",
						search: { step: onboardingSession.status },
					});
				}
				throw redirect({ to: resolved.allowedPath });
			}
		}

		const billingStateResult = await billingStatePromise;
		if (!billingStateResult.ok) {
			throw billingStateResult.error;
		}

		const billingState = billingStateResult.value;

		return {
			session,
			account,
			theme,
			billingState,
			onboardingSession,
			identity,
		};
	},
	// Durable (DB) consent for this signed-in user, resolved server-side so the
	// banner renders flash-free. Lives on the authenticated layout — not the
	// root — so public/marketing pages never solicit analytics consent or pay
	// for the lookup; the gate appears only once the user is in the product.
	loader: () => getInitialConsentState(),
	component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
	const {
		theme: themeColor,
		account,
		session,
		billingState,
		onboardingSession,
		identity,
	} = Route.useRouteContext();
	const consent = Route.useLoaderData();
	const analytics = useAnalytics();

	// PostHog identity. Without this, client events (anonymous cookie ID) and
	// server events (account UUID) end up on two different person profiles,
	// which silently breaks any cross-boundary funnel. Identify is idempotent
	// per accountId — re-runs only when the user actually changes.
	//
	// Only the Spotify identity is attached as a person property — the public
	// handle (open.spotify.com/user/<id>) and the Spotify display name. We
	// deliberately do NOT send email or avatar URL; those are Google PII.
	useEffect(() => {
		analytics.identify(session.accountId, {
			spotify_id: account?.spotify_id ?? undefined,
			spotify_display_name: account?.display_name ?? undefined,
		});
	}, [
		analytics,
		session.accountId,
		account?.spotify_id,
		account?.display_name,
	]);

	const mode = sessionMode(onboardingSession);
	const isComplete = mode === "complete";
	const showShell = isComplete || mode === "walkthrough";

	useActiveJobCompletionEffects(session.accountId, isComplete);
	// Post-purchase return must observe the *real* billing state — it handles
	// real Stripe redirects, not display.
	usePostPurchaseReturn(session.accountId, billingState);

	const { data: matchingSession } = useQuery({
		...matchingSessionQueryOptions(session.accountId),
		enabled: isComplete,
	});
	const pendingSuggestions = matchingSession?.totalSongs ?? 0;

	const devPanel = DevWorkflowPanel ? (
		<Suspense fallback={null}>
			<DevWorkflowPanel />
		</Suspense>
	) : null;

	const [bannerDismissed, setBannerDismissed] = useState(() => {
		if (typeof window === "undefined") return false;
		return (
			window.sessionStorage.getItem(unverifiedBannerKey(identity.email)) === "1"
		);
	});
	const showBanner = !identity.emailVerified && !bannerDismissed;

	function dismissBanner() {
		setBannerDismissed(true);
		if (typeof window !== "undefined") {
			window.sessionStorage.setItem(unverifiedBannerKey(identity.email), "1");
		}
	}

	async function resendVerification() {
		await sendVerificationEmail({
			email: identity.email,
			callbackURL: "/verify-email",
		});
	}

	const banner = showBanner ? (
		<UnverifiedEmailBanner
			email={identity.email}
			onResend={resendVerification}
			onDismiss={dismissBanner}
		/>
	) : null;

	const layout = (
		<>
			<AuthenticatedThemeProvider
				initialThemeColor={themeColor ?? DEFAULT_THEME}
			>
				{showShell ? (
					<AuthenticatedShell
						accountId={session.accountId}
						account={account}
						billingState={billingState}
						pendingSuggestions={pendingSuggestions}
						devPanel={devPanel}
						showSidebar={isComplete}
						banner={banner}
					/>
				) : (
					<>
						{banner}
						<Outlet />
						{devPanel}
					</>
				)}
			</AuthenticatedThemeProvider>
			<Toaster richColors position="top-right" />
		</>
	);

	// Consent UI lives only where PostHog does (production), mirroring the PROD
	// gate in getPostHogConfig (__root.tsx); dev has no PostHogProvider ancestor
	// to gate. Mounting it here — not at the root — keeps the analytics and
	// session-replay consent prompt off public pages: it surfaces only after
	// sign-in, where identified capture and replay actually begin.
	if (!import.meta.env.PROD) return layout;

	return (
		<ConsentProvider
			isAuthenticated={consent.isAuthenticated}
			initialConsent={consent.consent}
		>
			{layout}
			<ConsentBanner />
		</ConsentProvider>
	);
}

function unverifiedBannerKey(email: string) {
	return `hearted.unverified-banner-dismissed:${email}`;
}

function waitlistWelcomeKey(accountId: string) {
	return `hearted.waitlist-welcome-seen:${accountId}`;
}

function AuthenticatedShell({
	accountId,
	account,
	billingState,
	pendingSuggestions,
	devPanel,
	showSidebar,
	banner,
}: {
	accountId: string;
	account: Awaited<ReturnType<typeof requireAuthSession>>["account"] | null;
	billingState: BillingState;
	pendingSuggestions: number;
	devPanel: React.ReactNode;
	showSidebar: boolean;
	banner: React.ReactNode;
}) {
	const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);

	// Temporary waitlist greeting. Dismiss is persisted to localStorage (the
	// feature is short-lived, so we skip a schema migration); the query only
	// runs for complete users who haven't dismissed it yet.
	const [welcomeDismissed, setWelcomeDismissed] = useState(() => {
		if (typeof window === "undefined") return false;
		return window.localStorage.getItem(waitlistWelcomeKey(accountId)) === "1";
	});
	const { data: waitlistWelcome } = useQuery({
		queryKey: billingKeys.waitlistWelcome,
		queryFn: () => getWaitlistWelcome(),
		enabled: showSidebar && !welcomeDismissed,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const showWelcome =
		showSidebar && !welcomeDismissed && waitlistWelcome?.eligible === true;

	function dismissWelcome() {
		setWelcomeDismissed(true);
		if (typeof window !== "undefined") {
			window.localStorage.setItem(waitlistWelcomeKey(accountId), "1");
		}
	}

	// "Free" in user terms: no unlimited access and no purchased credits.
	// Song-Pack users (creditBalance > 0) have already converted, so we don't
	// nudge them in the sidebar. They can still upgrade from /settings.
	const showUpgradeCTA =
		!hasUnlimitedAccess(billingState) && billingState.creditBalance === 0;

	return (
		<div className="theme-bg theme-text flex min-h-screen flex-col">
			{banner}
			<div className="flex flex-1">
				{showSidebar && (
					<Sidebar
						unsortedCount={pendingSuggestions}
						handle={account?.handle ?? null}
						userPlan={getPlanLabel(billingState)}
						userBalance={getDisplayBalance(billingState)}
						userImageUrl={account?.image_url}
						showUpgradeCTA={showUpgradeCTA}
						onUpgradeClick={() => setShowUpgradeDialog(true)}
					/>
				)}
				<main className="flex-1 p-8">
					<Outlet />
				</main>
			</div>
			{devPanel}
			{showUpgradeDialog && (
				<UpgradeDialog
					billingState={billingState}
					onClose={() => setShowUpgradeDialog(false)}
				/>
			)}
			{showWelcome && <WaitlistWelcomeDialog onClose={dismissWelcome} />}
		</div>
	);
}
