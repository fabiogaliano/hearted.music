/**
 * /_authenticated - Pathless layout for authenticated routes.
 *
 * All child routes (dashboard, onboarding, etc.) inherit auth protection.
 * Handles: unauthenticated redirect, orphaned session cleanup.
 *
 * Children access session via: Route.useRouteContext().session
 */

import { Outlet, createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/auth/guards";

export const Route = createFileRoute("/_authenticated")({
	beforeLoad: async () => {
		const session = await requireAuth();
		return { session };
	},
	component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
	return <Outlet />;
}
