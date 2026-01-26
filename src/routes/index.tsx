/**
 * / - Landing Page
 *
 * Routing logic:
 * - Not logged in: Show landing + login button
 * - Logged in + incomplete onboarding: Redirect to /onboarding
 * - Logged in + complete: Show app (landing page is the app)
 */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { Landing } from "@/features/landing/Landing";
import { themes } from "@/lib/theme/colors";
import { type ThemeColor, DEFAULT_THEME } from "@/lib/theme/types";
import { getSession } from "@/lib/auth/session";
import { getOnboardingData } from "@/lib/server/onboarding.server";

/**
 * Server function to check auth status and load page data.
 * Must be a server function because getRequest() is server-only.
 */
const getIndexPageData = createServerFn({ method: "GET" }).handler(
	async (): Promise<
		| { isLoggedIn: false }
		| { isLoggedIn: true; isComplete: false; currentStep: string }
		| { isLoggedIn: true; isComplete: true; theme: ThemeColor | null }
	> => {
		const request = getRequest();
		const session = getSession(request);

		// Not logged in
		if (!session) {
			return { isLoggedIn: false };
		}

		// Logged in - check onboarding status
		try {
			const data = await getOnboardingData();

			if (!data.isComplete) {
				return { isLoggedIn: true, isComplete: false, currentStep: data.currentStep };
			}

			return { isLoggedIn: true, isComplete: true, theme: data.theme };
		} catch (error) {
			// DB error - if it's a ConstraintError (account doesn't exist), the session is orphaned
			// This can happen after db reset or if account was deleted
			console.error("Failed to load onboarding data:", error);

			// Check if it's a foreign key constraint error (orphaned session)
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (
				errorMessage.includes("ConstraintError") ||
				errorMessage.includes("not present in table")
			) {
				console.warn(
					"Orphaned session detected - account no longer exists. User needs to clear cookies and re-login.",
				);
			}

			// Treat as not logged in (user will see login button)
			return { isLoggedIn: false };
		}
	},
);

export const Route = createFileRoute("/")({
	beforeLoad: async () => {
		const data = await getIndexPageData();

		// Not logged in - show landing
		if (!data.isLoggedIn) {
			return { isLoggedIn: false };
		}

		// Logged in but onboarding incomplete - redirect
		if (!data.isComplete) {
			throw redirect({ to: "/onboarding", search: { step: data.currentStep } });
		}

		// Onboarding complete - show app
		return {
			isLoggedIn: true,
			theme: data.theme,
		};
	},
	component: HomePage,
});

function HomePage() {
	const context = Route.useRouteContext();

	// Use theme from DB if logged in and chosen, otherwise use DEFAULT_THEME
	const effectiveTheme = context.isLoggedIn && context.theme
		? context.theme
		: DEFAULT_THEME;
	const theme = themes[effectiveTheme];

	return (
		<div className="relative min-h-screen" style={{ background: theme.bg }}>
			<Landing
				theme={theme}
				featuredSongIndex={0}
				isReleased={true}
			/>
		</div>
	);
}
