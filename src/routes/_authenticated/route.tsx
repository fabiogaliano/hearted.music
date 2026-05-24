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
import { UnverifiedEmailBanner } from "@/features/auth/UnverifiedEmailBanner";
import { usePostPurchaseReturn } from "@/features/billing/hooks/usePostPurchaseReturn";
import { billingKeys } from "@/features/billing/query-keys";
import { matchingSessionQueryOptions } from "@/features/matching/queries";
import {
	isPathAllowed,
	resolveSession,
	sessionMode,
} from "@/features/onboarding/step-resolver";
import { getDisplayBalance, getPlanLabel } from "@/lib/domains/billing/display";
import type { BillingState } from "@/lib/domains/billing/state";
import { hasUnlimitedAccess } from "@/lib/domains/billing/state";
import { useActiveJobCompletionEffects } from "@/lib/hooks/useActiveJobs";
import { useAnalytics } from "@/lib/observability/useAnalytics";
import { sendVerificationEmail } from "@/lib/platform/auth/auth-client";
import { requireAuthSession } from "@/lib/server/auth.functions";
import { getBillingState } from "@/lib/server/billing.functions";
import { getOnboardingSession } from "@/lib/server/onboarding.functions";
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

const authQueryKey = ["auth", "session"] as const;
const onboardingSessionQueryKey = ["auth", "onboarding-session"] as const;

export const Route = createFileRoute("/_authenticated")({
	beforeLoad: async ({ location, context }) => {
		const { queryClient } = context;

		const { session, account, identity } = await queryClient.ensureQueryData({
			queryKey: authQueryKey,
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
			queryKey: onboardingSessionQueryKey,
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

	return (
		<>
			<AuthenticatedThemeProvider
				initialThemeColor={themeColor ?? DEFAULT_THEME}
			>
				{showShell ? (
					<AuthenticatedShell
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
}

function unverifiedBannerKey(email: string) {
	return `hearted.unverified-banner-dismissed:${email}`;
}

function AuthenticatedShell({
	account,
	billingState,
	pendingSuggestions,
	devPanel,
	showSidebar,
	banner,
}: {
	account: Awaited<ReturnType<typeof requireAuthSession>>["account"] | null;
	billingState: BillingState;
	pendingSuggestions: number;
	devPanel: React.ReactNode;
	showSidebar: boolean;
	banner: React.ReactNode;
}) {
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
						userName={account?.display_name ?? account?.email ?? null}
						userPlan={getPlanLabel(billingState)}
						userBalance={getDisplayBalance(billingState)}
						userImageUrl={account?.image_url}
						showUpgradeCTA={showUpgradeCTA}
					/>
				)}
				<main className="flex-1 p-8">
					<Outlet />
				</main>
			</div>
			{devPanel}
		</div>
	);
}
